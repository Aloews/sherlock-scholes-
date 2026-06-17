-- ============================================================
-- SHERLOCK SCHOLES — Migration: onboarding (progressive difficulty)
--
-- New players' first ~10 games should feel EASY (only very recognizable
-- cards), then smoothly widen to the full deck by ~game 30. The frontend
-- computes a pageviews floor from games_played and passes it as p_difficulty
-- to pick_random_cards. tier legendary/epic and the wc2026 tag ALWAYS pass
-- (floor never hides them). Applies ONLY to the default quick game — when the
-- player picks a specific chip the frontend sends p_difficulty=NULL.
--
-- Depends on supabase/migrations/pro_users.sql (users, tg_validate_init_data).
-- Run in the Supabase SQL Editor AFTER pro_users.sql + pro_deck.sql.
--
-- ATOMIC: the whole migration runs in one transaction so a failed CREATE can
-- never leave pick_random_cards dropped-but-not-recreated (that bug took down
-- prod once — see hotfix_pick_random_cards.sql). `notify pgrst` is outside the
-- transaction so PostgREST only reloads after the commit lands.
-- ============================================================

begin;

-- 1) games counter on users (you said you'd run this ALTER — kept here,
--    idempotent, so the migration is self-contained).
alter table users add column if not exists games_played int not null default 0;

-- 2) get_user_status now also returns games_played (frontend reads it on load
--    to know the starting difficulty without an extra round-trip).
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
    'telegram_id',  v_row.telegram_id,
    'is_pro',       v_row.is_pro,
    'pro_since',    v_row.pro_since,
    'games_played', v_row.games_played
  );
end;
$$;

-- 3) bump_games — increment on quick-game start, return the new count.
--    Validated initData only (logged-in users); anonymous players count via
--    Telegram CloudStorage on the client. NULL when initData is missing.
create or replace function bump_games(p_init_data text)
returns int
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id bigint;
  v_n  int;
begin
  v_id := tg_validate_init_data(p_init_data);
  if v_id is null then
    return null;
  end if;
  insert into users (telegram_id, games_played) values (v_id, 1)
  on conflict (telegram_id) do update
    set games_played = users.games_played + 1, updated_at = now()
  returning games_played into v_n;
  return v_n;
end;
$$;

-- 4) pick_random_cards gains p_difficulty (a pageviews floor). Adding a param
--    makes a new overload — drop the 6-arg one first (6-arg calls still work:
--    p_difficulty defaults NULL = no cap).
drop function if exists pick_random_cards(int, text[], bigint, text[], text[], text);

create or replace function pick_random_cards(
  p_count         int,
  p_categories    text[]  default null,
  p_min_pageviews bigint  default null,
  p_continents    text[]  default null,
  p_tags          text[]  default null,
  p_init_data     text    default null,
  p_difficulty    int     default null
)
returns setof cards as $$
declare
  v_tags text[] := p_tags;
begin
  -- Pro-only tags (legend, ballon_dor) stripped for non-Pro callers.
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
      -- Onboarding difficulty floor: keep only recognizable cards while
      -- p_difficulty > 0. tier legendary/epic and wc2026 ALWAYS pass; cards
      -- with NULL pageviews are hidden until the cap lifts (p_difficulty<=0).
      and (
        p_difficulty is null
        or p_difficulty <= 0
        or pageviews >= p_difficulty
        or tier in ('legendary', 'epic')
        or tags && array['wc2026']
      )
    order by random()
    limit p_count;
end;
$$ language plpgsql stable;

revoke all on function bump_games(text) from public;
grant execute on function bump_games(text) to anon, authenticated;

commit;

-- Outside the transaction: PostgREST must reload only after the commit lands.
notify pgrst, 'reload schema';
