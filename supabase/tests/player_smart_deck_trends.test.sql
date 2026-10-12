-- Regression assertions for the data-driven Smart Deck trend RPC.
begin;

do $$
declare
  v_bad integer;
begin
  if to_regprocedure('public.player_smart_deck_trends(integer)') is null then
    raise exception 'player_smart_deck_trends(integer) is missing';
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
