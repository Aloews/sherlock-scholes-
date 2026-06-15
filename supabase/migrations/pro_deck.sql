-- ============================================================
-- SHERLOCK SCHOLES — Migration: Pro-only deck enforcement
--
-- Server-side guard so the pro-only tags ('legend', 'ballon_dor') are only
-- ever returned to a verified Pro user. The frontend already hides them
-- behind a lock, but a determined client could call pick_random_cards
-- directly — this strips those tags unless the validated initData maps to
-- users.is_pro = true. Defense in depth on top of the UI lock.
--
-- Depends on supabase/migrations/pro_users.sql (tg_validate_init_data, users).
-- Frontend contract (src/features/game/cardRandomizer.ts):
--   * sends p_init_data ONLY when a pro tag is requested;
--   * works BEFORE this migration — drops p_init_data after the first
--     PGRST202 and plays without server enforcement (UI lock still applies).
-- Run in the Supabase SQL Editor AFTER pro_users.sql.
-- ============================================================

-- The pro-only tag set, in one place.
create or replace function pro_only_tags()
returns text[]
language sql
immutable
as $$ select array['legend', 'ballon_dor']::text[] $$;

-- Validate initData and read is_pro. SECURITY DEFINER so it can reach Vault +
-- the private users table; returns false for missing/invalid initData.
create or replace function tg_is_pro(p_init_data text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id bigint;
  v_is_pro boolean;
begin
  v_id := tg_validate_init_data(p_init_data);
  if v_id is null then
    return false;
  end if;
  select is_pro into v_is_pro from users where telegram_id = v_id;
  return coalesce(v_is_pro, false);
end;
$$;

-- Adding p_init_data creates a new overload — drop the 5-arg one first so
-- callers don't hit an ambiguous match (5-arg calls keep working: the new
-- param has a DEFAULT).
drop function if exists pick_random_cards(int, text[], bigint, text[], text[]);

create or replace function pick_random_cards(
  p_count         int,
  p_categories    text[]  default null,
  p_min_pageviews bigint  default null,
  p_continents    text[]  default null,
  p_tags          text[]  default null,
  p_init_data     text    default null
)
returns setof cards as $$
declare
  v_tags text[] := p_tags;
begin
  -- If a pro-only tag is requested by a non-Pro caller, strip it. If the
  -- request was pro-only (nothing left), force an impossible tag so the
  -- overlap matches nothing (empty deck) rather than falling back to "all".
  if v_tags is not null
     and cardinality(v_tags) > 0
     and (v_tags && pro_only_tags())
     and not tg_is_pro(p_init_data) then
    v_tags := array(
      select t from unnest(v_tags) t
      where not (t = any(pro_only_tags()))
    );
    if cardinality(v_tags) = 0 then
      v_tags := array['__pro_locked__'];
    end if;
  end if;

  return query
    select *
    from cards
    where active = true
      and (
        p_categories is null
        or cardinality(p_categories) = 0
        or category = any(p_categories)
      )
      and (
        p_min_pageviews is null
        or pageviews is null
        or pageviews > p_min_pageviews
      )
      and (
        p_continents is null
        or cardinality(p_continents) = 0
        or category <> 'player'
        or continent = any(p_continents)
        or (continent is null and 'other' = any(p_continents))
      )
      and (
        v_tags is null
        or cardinality(v_tags) = 0
        or tags && v_tags
      )
    order by random()
    limit p_count;
end;
$$ language plpgsql stable;

revoke all on function tg_is_pro(text) from public;  -- internal; used by the RPC

notify pgrst, 'reload schema';
