-- Run manually against a non-production database after the migration is applied.
-- Also run by market-settlement-sql-regression.yml against disposable PostgreSQL.
do $$
declare
  v_player uuid;
  v_rows integer;
  v_claimed integer;
  v_slots jsonb;
begin
  if public.settle_market_pick('h2h', 'home', null, 2, 1) <> 'win' then raise exception 'h2h home win failed'; end if;
  if public.settle_market_pick('h2h', 'draw', null, 1, 1) <> 'win' then raise exception 'h2h draw failed'; end if;
  if public.settle_market_pick('totals', 'over', 2.5, 2, 1) <> 'win' then raise exception 'totals over failed'; end if;
  if public.settle_market_pick('totals', 'under', 2.5, 1, 1) <> 'win' then raise exception 'totals under failed'; end if;
  if public.settle_market_pick('totals', 'under', 2.0, 1, 1) <> 'push' then raise exception 'totals push failed'; end if;
  if public.settle_market_pick('spreads', 'home', -0.5, 2, 1) <> 'win' then raise exception 'spread home win failed'; end if;
  if public.settle_market_pick('spreads', 'home', -1.5, 2, 1) <> 'loss' then raise exception 'spread home loss failed'; end if;
  if public.settle_market_pick('btts', 'yes', null, 1, 0) <> 'loss' then raise exception 'btts no-goal failed'; end if;
  if public.settle_market_pick('draw_no_bet', 'home', null, 1, 1) <> 'push' then raise exception 'draw-no-bet push failed'; end if;
  if public.settle_market_pick('double_chance', 'home_draw', null, 1, 1) <> 'win' then raise exception 'double-chance failed'; end if;
  if public.settle_market_pick('totals', 'over', 2.25, 2, 1) <> 'unsupported_line' then raise exception 'quarter line must be unsupported'; end if;

  insert into public.cards (name, transfermarkt_id, market_value_eur)
  values ('Queue Test Player', '9912345', 500000)
  returning id into v_player;
  perform public.enqueue_player_enrichment();
  select count(*) into v_rows
    from public.player_enrichment_queue
   where card_id = v_player;
  if v_rows <> 2 then raise exception 'expected two queue jobs, got %', v_rows; end if;

  select count(*) into v_claimed
    from public.claim_player_enrichment_jobs(10, 'sql-test');
  if v_claimed <> 2 then raise exception 'expected two claimed jobs, got %', v_claimed; end if;

  update public.player_enrichment_queue
     set status = 'retryable', attempts = 1, next_attempt_at = now() + interval '1 hour',
         claimed_at = null
   where card_id = v_player and task_type = 'photo';
  perform public.enqueue_player_enrichment();
  if (select attempts from public.player_enrichment_queue
       where card_id = v_player and task_type = 'photo') <> 1 then
    raise exception 'enqueue reset retry attempt count';
  end if;

  insert into public.fixtures (id) values ('fixture-market-test');
  select public.upsert_market_odds(jsonb_build_array(jsonb_build_object(
    'fixture_id', 'fixture-market-test', 'observed_at', now(),
    'provider_key', 'test', 'region', 'eu', 'bookmaker', 'test-book',
    'market_key', 'totals', 'selection_key', 'over',
    'line_key', '2.5', 'line_value', 2.5, 'price', 1.91,
    'raw_outcome', jsonb_build_object('name', 'Over', 'point', 2.5)
  ))) into v_rows;
  if v_rows <> 1 then raise exception 'market quote upsert failed: %', v_rows; end if;
  if (select count(*) from public.market_odds where fixture_id = 'fixture-market-test' and market_key = 'totals') <> 1 then
    raise exception 'market quote was not persisted';
  end if;

  select public.claim_market_collection_slots(
    '[{"sport":"soccer_epl","market":"totals"},{"sport":"soccer_epl","market":"btts"},{"sport":"soccer_epl","market":"spreads"}]'::jsonb,
    2
  ) into v_slots;
  if jsonb_array_length(v_slots) <> 2 then raise exception 'market rotation returned wrong slot count'; end if;
end;
$$;
