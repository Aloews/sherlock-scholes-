-- Regression test for 20261009190000_fix_player_rating_cache_and_card_verification.sql.
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
  v_result text;
begin
  insert into public.cards (name, name_en, category, active)
  values ('ZZTESTCACHE Rating Fixture', 'ZZTESTCACHE Rating Fixture', 'player', true)
  returning id into v_card;

  insert into public.player_match_stats
    (card_id, match_date, tournament, minutes, goals, assists, source)
  values
    (v_card, current_date, 'ZZTESTCACHE League', 90, 1, 1, 'sports.ru');

  -- Must complete despite the production guard against unqualified DELETE.
  v_result := public.refresh_player_rating_cache();

  select count(*) into v_days
    from public.player_rating_cache
   where card_id = v_card;

  assert v_days = 3,
    'a player with a goal and assist must have cache rows for 7/30/365 days; got '
    || v_days;

  select goals, assists into v_goals, v_assists
    from public.player_rating_cache
   where card_id = v_card and days = 7;

  assert v_goals = 1 and v_assists = 1,
    'cache must preserve fixture stats; got goals=' || v_goals
    || ', assists=' || v_assists;

  assert v_result is not null and v_result like 'строк:%',
    'refresh must return a row-count summary';
end
$test$;

select 'player_rating_cache_refresh: all assertions passed' as result;

rollback;
