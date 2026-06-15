-- ============================================================
-- SHERLOCK SCHOLES — player card reports + moderator role
-- Run in the Supabase SQL Editor (after admin_card_editor.sql).
--
-- Model (same as the admin editor): anon NEVER touches the table
-- directly — RLS is ON with no policies, so the only access paths are
-- the SECURITY DEFINER functions below. Players can INSERT a report
-- (rate-limited); only staff (admin OR moderator password) can read or
-- resolve them. No personal data is stored: device_id is an anonymous
-- random id from localStorage, used solely for throttling.
-- ============================================================

-- ── 1) Reports table ────────────────────────────────────────
create table if not exists card_reports (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references cards(id) on delete cascade,
  reason     text not null check (reason in ('photo', 'name', 'club', 'other')),
  comment    text,
  device_id  text,                       -- anonymous random id; throttle only
  status     text not null default 'new' check (status in ('new', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists idx_card_reports_status_card
  on card_reports(status, card_id);
create index if not exists idx_card_reports_device_time
  on card_reports(device_id, created_at);

-- RLS on, NO policies => anon/authenticated get zero direct access. Every
-- read/write goes through the gated functions below.
alter table card_reports enable row level security;

-- Deletion-candidate flag (Part B3): a moderator who sees in the analytics
-- dashboard that a card is skipped a lot can flag it; the full admin reviews
-- and deletes. (tganalytics is external, so this is a manual flag, by design.)
alter table cards add column if not exists delete_candidate boolean not null default false;

-- ── 2) Moderator password in Vault (run ONCE, CHANGE the value) ──
--    Its own secret, separate from admin_password. Admin can do everything;
--    moderator can view/resolve reports + edit cards, but NOT delete.
select vault.create_secret('CHANGE_ME_MODERATOR_PASSWORD', 'moderator_password');
-- Change later (do NOT create a duplicate):
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'moderator_password'),
--     'NEW_MODERATOR_PASSWORD');

-- ── 3) Role check — reads both Vault secrets, returns the role or null ──
create or replace function staff_role(p_password text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_admin text; v_mod text;
begin
  select decrypted_secret into v_admin
    from vault.decrypted_secrets where name = 'admin_password' limit 1;
  if p_password is not null and v_admin is not null and p_password = v_admin then
    return 'admin';
  end if;
  select decrypted_secret into v_mod
    from vault.decrypted_secrets where name = 'moderator_password' limit 1;
  if p_password is not null and v_mod is not null and p_password = v_mod then
    return 'moderator';
  end if;
  perform pg_sleep(0.5);  -- mild brute-force throttle
  return null;
end;
$$;

-- true for admin OR moderator — the gate for "can edit cards / see reports".
create or replace function staff_check_password(p_password text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$ select staff_role(p_password) is not null; $$;

-- Frontend login probe: returns 'admin' | 'moderator' | null (the UI hides
-- admin-only controls when the role is 'moderator').
create or replace function staff_verify(p_password text)
returns text
language sql
security definer
set search_path = public, vault
as $$ select staff_role(p_password); $$;

-- ── 4) report_card — anon INSERT, rate-limited, no read-back ──
create or replace function report_card(
  p_card_id   uuid,
  p_reason    text,
  p_comment   text default null,
  p_device_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reason not in ('photo', 'name', 'club', 'other') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;
  if not exists (select 1 from cards where id = p_card_id) then
    raise exception 'no_such_card' using errcode = '23503';
  end if;

  -- Throttle per anonymous device: <=10 reports/hour, and no duplicate OPEN
  -- report for the same (device, card).
  if p_device_id is not null and p_device_id <> '' then
    if (select count(*) from card_reports
          where device_id = p_device_id
            and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'rate_limited' using errcode = '53400';
    end if;
    if exists (select 1 from card_reports
                 where device_id = p_device_id and card_id = p_card_id
                   and status = 'new') then
      return;  -- already reported this card — silent no-op
    end if;
  end if;

  insert into card_reports (card_id, reason, comment, device_id)
  values (p_card_id, p_reason, left(nullif(trim(p_comment), ''), 280), p_device_id);
end;
$$;

-- ── 5) mod_list_reports — staff only, aggregated by card, most-reported first ──
create or replace function mod_list_reports(p_password text)
returns table (
  card_id          uuid,
  card_name        text,
  card_name_en     text,
  category         text,
  photo_url        text,
  active           boolean,
  delete_candidate boolean,
  report_count     bigint,
  reasons          text,
  last_comment     text,
  last_reported_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select c.id, c.name, c.name_en, c.category, c.photo_url, c.active,
           c.delete_candidate,
           count(*) as report_count,
           string_agg(distinct r.reason, ', ') as reasons,
           (array_agg(r.comment order by r.created_at desc)
              filter (where r.comment is not null))[1] as last_comment,
           max(r.created_at) as last_reported_at
    from card_reports r
    join cards c on c.id = r.card_id
    where r.status = 'new'
    group by c.id
    order by report_count desc, last_reported_at desc;
end;
$$;

-- ── 6) mod_resolve_card_reports — staff; close all OPEN reports for a card ──
create or replace function mod_resolve_card_reports(p_password text, p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  update card_reports set status = 'resolved'
    where card_id = p_card_id and status = 'new';
end;
$$;

-- ── 7) mod_flag_candidate — staff; toggle the deletion-candidate flag ──
create or replace function mod_flag_candidate(p_password text, p_card_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  update cards set delete_candidate = coalesce(p_on, false) where id = p_card_id;
end;
$$;

-- ── 8) Let moderators (not just admin) EDIT cards ──
--    Re-point admin_save_card's gate to staff (admin OR moderator). Deleting/
--    deactivating (admin_delete_card) stays ADMIN-ONLY — moderators flag a
--    deletion candidate instead. Body is unchanged except the auth check.
create or replace function admin_save_card(p_password text, p_card jsonb)
returns cards
language plpgsql
security definer
set search_path = public, vault
as $$
declare r cards;
declare v_id uuid;
begin
  if not staff_check_password(p_password) then        -- was admin_check_password
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  v_id := nullif(p_card->>'id', '')::uuid;

  if v_id is null then
    insert into cards (
      name, name_en, category, category_ru, continent, country,
      position_ru, photo_url, clubs_minutes, pageviews, forbidden_words, active
    ) values (
      p_card->>'name',
      nullif(p_card->>'name_en', ''),
      p_card->>'category',
      nullif(p_card->>'category_ru', ''),
      nullif(p_card->>'continent', ''),
      nullif(p_card->>'country', ''),
      nullif(p_card->>'position_ru', ''),
      nullif(p_card->>'photo_url', ''),
      case when p_card ? 'clubs_minutes' then p_card->'clubs_minutes' else null end,
      nullif(p_card->>'pageviews', '')::bigint,
      coalesce((select array_agg(x)
                from jsonb_array_elements_text(p_card->'forbidden_words') x),
               array[]::text[]),
      coalesce((p_card->>'active')::boolean, true)
    )
    returning * into r;
  else
    update cards set
      name          = coalesce(nullif(p_card->>'name', ''), name),
      name_en       = nullif(p_card->>'name_en', ''),
      category      = coalesce(nullif(p_card->>'category', ''), category),
      category_ru   = nullif(p_card->>'category_ru', ''),
      continent     = nullif(p_card->>'continent', ''),
      country       = nullif(p_card->>'country', ''),
      position_ru   = nullif(p_card->>'position_ru', ''),
      photo_url     = nullif(p_card->>'photo_url', ''),
      clubs_minutes = case when p_card ? 'clubs_minutes'
                           then p_card->'clubs_minutes' else clubs_minutes end,
      pageviews     = nullif(p_card->>'pageviews', '')::bigint,
      forbidden_words = coalesce(
        (select array_agg(x) from jsonb_array_elements_text(p_card->'forbidden_words') x),
        forbidden_words),
      active        = coalesce((p_card->>'active')::boolean, active)
    where id = v_id
    returning * into r;
    if not found then
      raise exception 'card % not found', v_id;
    end if;
  end if;
  return r;
end;
$$;

-- ── 9) Grants ────────────────────────────────────────────────
revoke all on function staff_role(text)              from public;
revoke all on function staff_check_password(text)    from public;
revoke all on function staff_verify(text)            from public;
revoke all on function report_card(uuid, text, text, text) from public;
revoke all on function mod_list_reports(text)        from public;
revoke all on function mod_resolve_card_reports(text, uuid) from public;
revoke all on function mod_flag_candidate(text, uuid, boolean) from public;
-- staff_role / staff_check_password are internal — NOT granted to clients.
grant execute on function staff_verify(text)            to anon, authenticated;
grant execute on function report_card(uuid, text, text, text) to anon, authenticated;
grant execute on function mod_list_reports(text)        to anon, authenticated;
grant execute on function mod_resolve_card_reports(text, uuid) to anon, authenticated;
grant execute on function mod_flag_candidate(text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
