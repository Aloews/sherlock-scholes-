-- ============================================================
-- SHERLOCK SCHOLES — Migration: Pro users (Telegram Stars, one-time)
--
-- Premium model SCAFFOLD. NO real payment here — `is_pro` is just a flag
-- you flip for testing (admin_set_pro). The payment webhook that sets it
-- for real is a SEPARATE later step.
--
-- SECURITY (the whole point):
--   * The Telegram user id is NEVER taken from the frontend. The client
--     sends the raw Telegram Mini App `initData` string; this DB validates
--     its HMAC-SHA256 signature against the BOT TOKEN kept in Vault
--     (pgcrypto, server-side). A forged/edited initData fails the check.
--   * `is_pro` is read from the `users` table by a SECURITY DEFINER RPC,
--     so it can't be faked by editing a JS variable in DevTools.
--   * `users` has RLS on and NO public policies — anon/authenticated can
--     only EXECUTE the gated RPCs, never read/write the table directly.
--
-- Mirrors the admin-editor pattern (docs/admin_card_editor.sql): a secret
-- in Vault + SECURITY DEFINER functions that refuse to act unless valid.
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

-- pgcrypto provides hmac()/digest(). On Supabase it lives in `extensions`.
create extension if not exists pgcrypto with schema extensions;

-- ── 1) Bot token in Vault (run ONCE, CHANGE the value) ──
--    This is the SAME token you gave @BotFather. It's the HMAC key Telegram
--    used to sign initData, so we need it to verify the signature.
select vault.create_secret('CHANGE_ME_BOT_TOKEN', 'telegram_bot_token');
-- Change later (do NOT create a duplicate):
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'telegram_bot_token'),
--     'NEW_BOT_TOKEN');

-- ── 2) users table ──
create table if not exists users (
  telegram_id bigint primary key,
  is_pro      boolean     not null default false,
  pro_since   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table users enable row level security;
-- No policies on purpose: only the SECURITY DEFINER RPCs below touch this
-- table. Revoke any default grants so the anon key can't read it directly.
revoke all on table users from anon, authenticated;

-- ── 3) Internal: URL-decode an initData value (%XX + '+') ──
--    initData arrives percent-encoded; the data-check-string is built from
--    DECODED values. No SQL builtin does this, so we do it byte-wise.
create or replace function _tg_url_decode(p text)
returns text
language plpgsql
immutable
as $$
declare
  result bytea := '\x';
  s text := replace(p, '+', ' ');
  n int := length(s);
  i int := 1;
  c text;
begin
  while i <= n loop
    c := substr(s, i, 1);
    if c = '%' and i + 2 <= n then
      result := result || decode(substr(s, i + 1, 2), 'hex');
      i := i + 3;
    else
      result := result || convert_to(c, 'utf8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(result, 'utf8');
end;
$$;

-- ── 4) Internal: validate initData signature, return the Telegram id ──
--    Returns the bigint user id when the signature (and freshness) check
--    out, else NULL. Telegram's algorithm:
--      secret_key   = HMAC_SHA256(key="WebAppData", msg=bot_token)
--      data_check   = all fields except `hash`, decoded, sorted by key,
--                     joined as "key=value" with '\n'
--      valid  <=>   HMAC_SHA256(key=secret_key, msg=data_check) == hash
create or replace function tg_validate_init_data(p_init_data text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_token   text;
  v_pair    text;
  v_eq      int;
  v_key     text;
  v_val     text;
  v_hash    text := null;
  v_auth    bigint := null;
  v_user    text := null;
  v_keys    text[] := '{}';
  v_vals    text[] := '{}';
  v_dcs     text;
  v_secret  bytea;
  v_calc    text;
  v_id      bigint;
begin
  if p_init_data is null or length(p_init_data) = 0 then
    return null;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'telegram_bot_token'
  limit 1;
  if v_token is null then
    return null;  -- bot token not configured yet
  end if;

  -- split into key=value pairs; keep `hash` aside, decode the rest
  foreach v_pair in array string_to_array(p_init_data, '&') loop
    v_eq := position('=' in v_pair);
    if v_eq = 0 then continue; end if;
    v_key := substr(v_pair, 1, v_eq - 1);
    v_val := substr(v_pair, v_eq + 1);
    if v_key = 'hash' then
      v_hash := lower(v_val);  -- hex, no decode
    else
      v_keys := array_append(v_keys, v_key);
      v_vals := array_append(v_vals, _tg_url_decode(v_val));
      if v_key = 'auth_date' then
        v_auth := _tg_url_decode(v_val)::bigint;
      elsif v_key = 'user' then
        v_user := _tg_url_decode(v_val);
      end if;
    end if;
  end loop;

  if v_hash is null then return null; end if;

  -- data_check_string: "key=value" lines, sorted alphabetically by key
  select string_agg(line, e'\n' order by k)
  into v_dcs
  from (
    select v_keys[i] as k, v_keys[i] || '=' || v_vals[i] as line
    from generate_subscripts(v_keys, 1) as i
  ) t;

  v_secret := hmac(v_token, 'WebAppData', 'sha256');
  v_calc   := encode(hmac(convert_to(v_dcs, 'utf8'), v_secret, 'sha256'), 'hex');

  if v_calc <> v_hash then
    return null;  -- bad signature
  end if;

  -- replay guard: reject initData older than 24h
  if v_auth is null or v_auth < extract(epoch from now())::bigint - 86400 then
    return null;
  end if;

  begin
    v_id := (v_user::jsonb ->> 'id')::bigint;
  exception when others then
    v_id := null;
  end;

  return v_id;
end;
$$;

-- ── 5) Public RPC: validated Pro status for the current user ──
--    Frontend calls this at startup with window.Telegram.WebApp.initData.
--    Upserts the row (first-seen) and returns is_pro from the DB.
create or replace function get_user_status(p_init_data text)
returns json
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id  bigint;
  v_row users;
begin
  v_id := tg_validate_init_data(p_init_data);
  if v_id is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  insert into users (telegram_id) values (v_id)
  on conflict (telegram_id) do update set updated_at = now()
  returning * into v_row;

  return json_build_object(
    'telegram_id', v_row.telegram_id,
    'is_pro',      v_row.is_pro,
    'pro_since',   v_row.pro_since
  );
end;
$$;

-- ── 6) Admin-gated Pro toggle — FOR TESTING (no payment) ──
--    Reuses the admin password (docs/admin_card_editor.sql). Lets you grant
--    Pro to any tester so the unlocked UI can be verified before Stars is
--    wired. The real payment webhook will set is_pro a different way.
create or replace function admin_set_pro(p_password text, p_telegram_id bigint, p_on boolean)
returns json
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_row users;
begin
  if not admin_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  insert into users (telegram_id, is_pro, pro_since)
  values (p_telegram_id, p_on, case when p_on then now() else null end)
  on conflict (telegram_id) do update
    set is_pro    = excluded.is_pro,
        pro_since = case when excluded.is_pro
                         then coalesce(users.pro_since, now()) else null end,
        updated_at = now()
  returning * into v_row;

  return json_build_object(
    'telegram_id', v_row.telegram_id,
    'is_pro',      v_row.is_pro,
    'pro_since',   v_row.pro_since
  );
end;
$$;

-- ── 7) Grants ──
--    Only the two public-facing RPCs are EXECUTE-able by clients. The
--    internal validator/decoder stay private — they run as the function
--    owner inside the SECURITY DEFINER calls, so anon never needs them.
revoke all on function _tg_url_decode(text)                      from public;
revoke all on function tg_validate_init_data(text)               from public;
revoke all on function get_user_status(text)                     from public;
revoke all on function admin_set_pro(text, bigint, boolean)      from public;
grant execute on function get_user_status(text)                  to anon, authenticated;
grant execute on function admin_set_pro(text, bigint, boolean)   to anon, authenticated;

notify pgrst, 'reload schema';

-- ── How to test (server-side, no payment) ──
--   1) Set the bot token once:
--        select vault.update_secret(
--          (select id from vault.secrets where name='telegram_bot_token'),
--          '123456:your-real-bot-token');
--   2) Grant Pro to a tester by their Telegram id:
--        select admin_set_pro('<admin_password>', 123456789, true);
--   3) Reload the Mini App — get_user_status now returns is_pro=true.
--
-- ── VERIFY ──
--   select telegram_id, is_pro, pro_since from users order by updated_at desc;
