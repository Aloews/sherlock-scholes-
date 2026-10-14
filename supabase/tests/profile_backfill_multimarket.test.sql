-- Run only after profile_market_finetune_test_setup.sql and the migration.
begin;
do $$
declare v_card uuid; v_job record; v_count integer; v_status text; v_row record;
begin
  if public.settle_market_outcome('h2h','home',0,2,1) <> 'won' then raise exception 'h2h home'; end if;
  if public.settle_market_outcome('h2h','draw',0,2,1) <> 'lost' then raise exception 'h2h losing outcome'; end if;
  if public.settle_market_outcome('btts','yes',0,2,1) <> 'won' then raise exception 'btts yes'; end if;
  if public.settle_market_outcome('btts','no',0,2,0) <> 'won' then raise exception 'btts no'; end if;
  if public.settle_market_outcome('totals','over',2.5,2,1) <> 'won' then raise exception 'over 2.5'; end if;
  if public.settle_market_outcome('totals','under',2.5,2,1) <> 'lost' then raise exception 'under 2.5'; end if;
  if public.settle_market_outcome('totals','under',2.25,1,1) <> 'half_won' then raise exception 'quarter total half win'; end if;
  if public.settle_market_outcome('totals','over',2.25,1,1) <> 'half_lost' then raise exception 'quarter total half loss'; end if;
  if public.settle_market_outcome('spreads','home',0.25,1,1) <> 'half_won' then raise exception 'quarter handicap half win'; end if;
  if public.settle_market_outcome('spreads','home',-0.25,1,1) <> 'half_lost' then raise exception 'quarter handicap half loss'; end if;

  -- Request reservation is idempotent and never spends the protected reserve.
  if not public.reserve_odds_api_request('regression-idempotency','the-odds-api','soccer_epl','eu',array['h2h'],1) then
    raise exception 'first request reservation failed';
  end if;
  if public.reserve_odds_api_request('regression-idempotency','the-odds-api','soccer_epl','eu',array['h2h'],1) then
    raise exception 'duplicate request was reserved twice';
  end if;
  if not public.spend_odds_credits_with_reserve(419,80) then raise exception 'budget should allow exactly 420 credits'; end if;
  if public.spend_odds_credits_with_reserve(1,80) then raise exception 'protected 80-credit reserve was spent'; end if;
  if (select credits from public.odds_api_budget where month=date_trunc('month',now() at time zone 'utc')::date) <> 420 then
    raise exception 'quota ledger did not preserve 80 credits';
  end if;

  -- One task per card/source, then claim + finish with explicit verification.
  insert into public.cards(name,category,active,transfermarkt_id,wikidata_qid,market_value_eur)
  values('Queue regression player','player',true,'tm-queue-regression','Q999999',1000)
  returning id into v_card;
  if public.enqueue_profile_backfill_jobs(100) < 3 then raise exception 'expected portrait and season tasks'; end if;
  select * into v_job from public.claim_profile_backfill_jobs(1,45);
  if v_job.id is null or v_job.status <> 'running' or v_job.attempts <> 1 then raise exception 'claim failed'; end if;
  v_status := public.finish_profile_backfill_job(v_job.id,true,false,null);
  if v_status <> 'succeeded' then raise exception 'verified queue task did not succeed'; end if;
  if (select count(*) from public.profile_backfill_jobs where card_id=v_card) <> 3 then
    raise exception 'queue did not create three distinct enrichment tasks';
  end if;

  -- Verify generic quote writes and automatic settlement when a final score arrives.
  insert into public.fixtures(id,sport_key,commence_at,home_team,away_team)
  values('market-regression-fixture','soccer_epl',now()-interval '2 hours','Home FC','Away FC');
  v_count := public.upsert_fixture_market_quotes(jsonb_build_array(
    jsonb_build_object('fixture_id','market-regression-fixture','taken_at',(now()-interval '3 hours')::text,
      'provider','the-odds-api','bookmaker','regression-book','region','eu','market_key','h2h',
      'outcome_key','draw','outcome_name','Draw','point',0,'price',3.2),
    jsonb_build_object('fixture_id','market-regression-fixture','taken_at',(now()-interval '90 minutes')::text,
      'provider','the-odds-api','bookmaker','regression-book','region','eu','market_key','totals',
      'outcome_key','under','outcome_name','Under','point',2.5,'price',1.9),
    jsonb_build_object('fixture_id','market-regression-fixture','taken_at',(now()-interval '90 minutes')::text,
      'provider','the-odds-api','bookmaker','regression-book','region','eu','market_key','btts',
      'outcome_key','yes','outcome_name','Yes','point',0,'price',2.0)
  ));
  if v_count <> 3 then raise exception 'quote upsert wrote % rows',v_count; end if;
  update public.fixtures set completed=true,home_score=1,away_score=1,scores_at=now(),updated_at=now()
   where id='market-regression-fixture';
  if (select settlement_status from public.fixture_market_quotes where fixture_id='market-regression-fixture' and market_key='h2h') <> 'won' then
    raise exception 'h2h quote was not settled';
  end if;
  if (select settlement_status from public.fixture_market_quotes where fixture_id='market-regression-fixture' and market_key='totals') <> 'won' then
    raise exception 'totals quote was not settled';
  end if;
  if (select settlement_status from public.fixture_market_quotes where fixture_id='market-regression-fixture' and market_key='btts') <> 'won' then
    raise exception 'btts quote was not settled';
  end if;

  -- Capture a real-shaped, immutable pre-kickoff example and label only after settlement.
  insert into public.fixtures(id,sport_key,commence_at,home_team,away_team)
  values('finetune-regression-fixture','soccer_epl',now()+interval '1 hour','Home FC','Away FC');
  insert into public.forecast_inputs(fixture_id,h_gf,h_ga,a_gf,a_ga)
  values('finetune-regression-fixture',1.5,0.8,1.2,1.1);
  insert into public.fixture_odds(fixture_id,taken_at,bookmaker,home_price,draw_price,away_price)
  values('finetune-regression-fixture',now()-interval '5 minutes','regression-book',2.0,3.2,3.8);
  insert into public.forecast_pick(fixture_id,model,commence_at,made_at)
  values('finetune-regression-fixture','llm',now()+interval '1 hour',now()-interval '1 minute');
  if not exists(select 1 from public.llm_finetune_examples where fixture_id='finetune-regression-fixture'
      and odds_snapshot_at < commence_at and feature_cutoff_at < commence_at) then
    raise exception 'pre-match fine-tune snapshot was not captured';
  end if;
  update public.fixtures set completed=true,home_score=2,away_score=0,
    scores_at=commence_at+interval '2 hours',updated_at=commence_at+interval '2 hours'
   where id='finetune-regression-fixture';
  if not exists(select 1 from public.export_llm_finetune_examples() where fixture_id='finetune-regression-fixture' and target_outcome='home') then
    raise exception 'settled fine-tuning example was not exported';
  end if;
end $$;
rollback;
