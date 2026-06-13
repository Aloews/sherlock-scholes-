-- ============================================================
-- SHERLOCK SCHOLES — admin card editor backend
-- Password is verified SERVER-SIDE against a secret kept in Supabase
-- Vault (NOT in the frontend, NOT in this file once you change it).
-- Direct writes to `cards` stay blocked by RLS (rls_lockdown.sql); the
-- only write path is these SECURITY DEFINER functions, which refuse to
-- act unless the password matches.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- 1) Store the admin password in Vault (run ONCE). CHANGE the value.
--    Vault is enabled by default on Supabase projects.
select vault.create_secret('CHANGE_ME_TO_A_STRONG_PASSWORD', 'admin_password');
-- To change it later (do NOT create a duplicate):
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'admin_password'),
--     'NEW_STRONG_PASSWORD');

-- 2) Internal password check — reads Vault, never exposed to clients.
create or replace function admin_check_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'admin_password'
  limit 1;
  if v_secret is null or p_password is null or p_password <> v_secret then
    perform pg_sleep(0.5);  -- mild brute-force throttle
    return false;
  end if;
  return true;
end;
$$;

-- 3) Login probe for the frontend gate (returns true/false only).
create or replace function admin_verify(p_password text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select admin_check_password(p_password);
$$;

-- 4) Insert (no id) or update (id present) a card. forbidden_words is
--    whatever the caller sends (the frontend generates it from the name).
create or replace function admin_save_card(p_password text, p_card jsonb)
returns cards
language plpgsql
security definer
set search_path = public, vault
as $$
declare r cards;
declare v_id uuid;
begin
  if not admin_check_password(p_password) then
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

-- 5) Deactivate (default) or hard-delete. Prefer soft delete: cards has an
--    FK from round_cards, so a hard delete can fail or cascade history.
create or replace function admin_delete_card(p_password text, p_id uuid,
                                             p_hard boolean default false)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not admin_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_hard then
    delete from cards where id = p_id;
  else
    update cards set active = false where id = p_id;
  end if;
end;
$$;

-- 6) Grants: clients may EXECUTE the gated functions (each checks the
--    password itself). Direct cards INSERT/UPDATE/DELETE for anon stays
--    forbidden by RLS — unchanged. The internal checker is NOT granted.
revoke all on function admin_check_password(text) from public;
revoke all on function admin_verify(text) from public;
revoke all on function admin_save_card(text, jsonb) from public;
revoke all on function admin_delete_card(text, uuid, boolean) from public;
grant execute on function admin_verify(text) to anon, authenticated;
grant execute on function admin_save_card(text, jsonb) to anon, authenticated;
grant execute on function admin_delete_card(text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- Search (task 3) needs no function: cards already has a public SELECT
-- policy (the game reads the deck), so the frontend can ilike directly,
-- including inactive cards. No card data here is sensitive.
