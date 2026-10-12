-- Regression assertions for the data-driven Smart Deck trend RPC.
begin;

do $$
declare
  v_bad integer;
  v_player uuid := '10000000-0000-0000-0000-000000000001';
  v_recent record;
begin
  if to_regprocedure('public.player_smart_deck_trends(integer)') is null then
    raise exception 'player_smart_deck_trends(integer) is missing';
  end if;

  insert into public.cards (id, name, name_en, category, active, position_ru)
  values (v_player, 'Trend Test Player', 'Trend Test Player', 'player', true, 'Forward')
  on conflict (id) do nothing;

  insert into public.player_match_stats (card_id, match_date, tournament, minutes, goals, assists, source, disputed)
  values
    (v_player, current_date - 5, 'League A', 90, 2, 0, 'source-a', false),
    (v_player, current_date - 5, 'League A', null, 8, 0, 'source-b', false),
    (v_player, current_date - 10, 'League A', 90, 1, 1, 'source-a', false),
    (v_player, current_date - 35, 'League A', 90, 0, 0, 'source-a', false),
    (v_player, current_date - 40, 'League A', 90, 1, 0, 'source-a', false),
    (v_player, current_date + 1, 'League A', 90, 9, 0, 'source-a', false),
    (v_player, current_date - 3, 'League A', 90, 7, 0, 'source-a', true);

  select * into v_recent from public.player_smart_deck_trends(1000) where card_id = v_player;
  if not found then raise exception 'test player missing from trend RPC'; end if;
  if v_recent.recent_matches <> 2 or v_recent.recent_goals <> 3 then
    raise exception 'recent window must deduplicate sources and exclude disputed/future matches; got matches %, goals %', v_recent.recent_matches, v_recent.recent_goals;
  end if;
  if v_recent.previous_matches <> 2 or v_recent.previous_goals <> 1 then
    raise exception 'previous window incorrect: matches %, goals %', v_recent.previous_matches, v_recent.previous_goals;
  end if;

  select count(*) into v_bad
  from public.player_smart_deck_trends(1000) t
  left join public.cards c on c.id = t.card_id
  where c.id is null or not c.active or c.category <> 'player';
  if v_bad <> 0 then raise exception 'trend RPC returned non-canonical/inactive/non-player card IDs: %', v_bad; end if;

  select count(*) into v_bad
  from public.player_smart_deck_trends(1000) t
  where t.recent_matches < 0 or t.previous_matches < 0
     or t.recent_goals < 0 or t.previous_goals < 0
     or t.recent_assists < 0 or t.previous_assists < 0
     or t.recent_points <> t.recent_goals * 4 + t.recent_assists * 3
     or t.previous_points <> t.previous_goals * 4 + t.previous_assists * 3;
  if v_bad <> 0 then raise exception 'invalid Smart Deck trend aggregates: %', v_bad; end if;

  select count(*) into v_bad
  from public.player_smart_deck_trends(1000) t
  where t.recent_last_match > current_date;
  if v_bad <> 0 then raise exception 'future match leaked into Smart Deck trends: %', v_bad; end if;
end;
$$;

rollback;
