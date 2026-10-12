-- Regression test for the cache refresh and per-card fallback migrations.
-- Run in a disposable/test database with the rating schema migrated:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/player_rating_cache_refresh.test.sql
-- The whole fixture, including the cache rebuild, is rolled back.

begin;

do $test$
declare
  v_card uuid;
  v_days integer;
  v_goals integer;
  v_assists integer;
  v_matches integer;
  v_minutes integer;
  v_result text;
begin
  insert into public.cards (name, name_en, category, active)
  values ('ZZTESTCACHE Rating Fixture', 'ZZTESTCACHE Rating Fixture', 'player', true)
  returning id into v_card;

  insert into public.player_match_stats
    (card_id, match_date, tournament, minutes, goals, assists, source)
  values
    (v_card, current_date, 'ZZTESTCACHE League', 90, 1, 1, 'sports.ru'),
    -- Upcoming fixtures may be present in the source table, but must not count
    -- as appearances or leak into a current rating window.
    (v_card, current_date + 1, 'ZZTESTCACHE League', 0, 0, 0, 'sports.ru');

  -- Must complete despite the production guard against unqualified DELETE.
  v_result := public.refresh_player_rating_cache();

  select count(*) into v_days
    from public.player_rating_cache
   where card_id = v_card;

  assert v_days = 3,
    'a player with a goal and assist must have cache rows for 7/30/365 days; got '
    || v_days;

  for v_days in select unnest(array[7, 30, 365]) loop
    select goals, assists, matches, minutes
      into v_goals, v_assists, v_matches, v_minutes
      from public.player_rating_cache
     where card_id = v_card and days = v_days;

    assert v_matches = 1 and v_minutes = 90,
      'window ' || v_days || ' must exclude future fixtures; got matches='
      || coalesce(v_matches::text, 'NULL') || ', minutes='
      || coalesce(v_minutes::text, 'NULL');

    assert v_goals = 1 and v_assists = 1,
      'window ' || v_days || ' must preserve fixture stats; got goals='
      || coalesce(v_goals::text, 'NULL') || ', assists='
      || coalesce(v_assists::text, 'NULL');
  end loop;

  assert position('"записано"' in pg_get_functiondef('public.verify_card_data()'::regprocedure)) > 0,
    'verify_card_data must read the actual Soccer Wiki output column "записано"';

  assert v_result is not null and v_result like 'строк:%',
    'refresh must return a row-count summary';

  -- Reproduce the production failure: another player's cache rows exist, but
  -- this player's row for the requested window is missing. The live fallback
  -- must still return the player rather than treating the partial cache as
  -- a complete leaderboard.
  delete from public.player_rating_cache
   where card_id = v_card and days = 7;

  select r.goals, r.assists, r.matches, r.minutes
    into v_goals, v_assists, v_matches, v_minutes
    from public.player_ratings(7, 10000) r
   where r.card_id = v_card;

  assert v_matches = 1 and v_minutes = 90,
    'live fallback must exclude future fixtures; got matches='
    || coalesce(v_matches::text, 'NULL') || ', minutes='
    || coalesce(v_minutes::text, 'NULL');

  assert v_goals = 1 and v_assists = 1,
    'missing per-card cache row must fall back to match-day stats; got goals='
    || coalesce(v_goals::text, 'NULL') || ', assists='
    || coalesce(v_assists::text, 'NULL');
end
$test$;

select 'player_rating_cache_refresh_and_partial_fallback: all assertions passed' as result;

rollback;
