\set ON_ERROR_STOP on
insert into public.cards (id, transfermarkt_id, market_value_eur, market_value_at)
values ('00000000-0000-0000-0000-000000000001', '316264', 80000000, '2026-10-07')
on conflict (id) do update set transfermarkt_id = excluded.transfermarkt_id,
  market_value_eur = excluded.market_value_eur, market_value_at = excluded.market_value_at;

do $$
declare
  v_written integer;
  v_seen integer;
  v_recorded integer;
  v_value bigint;
  v_source text;
  v_prob numeric;
begin
  select written, seen into v_written, v_seen
  from public.apply_card_market_values(jsonb_build_array(
    jsonb_build_object('card_id','00000000-0000-0000-0000-000000000001',
      'value_eur',65000000,'valued_at','2026-06-03',
      'source','Transfermarkt TMAPI market-value-history',
      'source_url','https://www.transfermarkt.com/spieler/profil/spieler/316264',
      'observed_at','2026-10-29T12:00:00Z')
  ));
  if v_seen <> 1 then raise exception 'expected one seen card, got %', v_seen; end if;
  select market_value_eur into v_value from public.cards
   where id = '00000000-0000-0000-0000-000000000001';
  if v_value <> 80000000 then raise exception 'older valuation overwrote newer value: %', v_value; end if;

  select written, seen into v_written, v_seen
  from public.apply_card_market_values(jsonb_build_array(
    jsonb_build_object('card_id','00000000-0000-0000-0000-000000000001',
      'value_eur',80000000,'valued_at','2026-10-07',
      'source','Transfermarkt TMAPI market-value-history',
      'source_url','https://www.transfermarkt.com/spieler/profil/spieler/316264',
      'observed_at','2026-10-29T12:00:00Z')
  ));
  select market_value_source into v_source from public.cards
   where id = '00000000-0000-0000-0000-000000000001';
  if v_source <> 'Transfermarkt TMAPI market-value-history' then
    raise exception 'source provenance not stored: %', v_source;
  end if;

  select recorded into v_recorded
  from public.record_market_value_reconciliation_issues(jsonb_build_array(
    jsonb_build_object('card_id','00000000-0000-0000-0000-000000000001',
      'transfermarkt_id','316264','api_value_eur',80000000,'api_valued_at','2026-10-07',
      'profile_value_eur',65000000,'profile_valued_at','2026-06-03',
      'observed_at','2026-10-29T12:00:00Z',
      'source_url','https://www.transfermarkt.com/spieler/profil/spieler/316264')
  ));
  if v_recorded <> 1 then raise exception 'expected one reconciliation issue, got %', v_recorded; end if;
  if not exists (select 1 from public.market_value_reconciliation_issue where status = 'open'
    and card_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'reconciliation issue not retained';
  end if;

  insert into public.award_candidate_snapshot
    (award_key, season_id, snapshot_date, card_id, competition_id, score_components)
  values ('ballon_dor', 2026, '2026-10-29', '00000000-0000-0000-0000-000000000001', '*',
          '{"raw_feature":0.5}'::jsonb);
  perform * from public.apply_forecast_calibration(jsonb_build_array(
    jsonb_build_object('kind','award','snapshot_date','2026-10-29','probability',0.42,
      'calibration_status','ready','training_examples',300,'model_version','walk-forward-platt-v1',
      'award_key','ballon_dor','season_id',2026,'competition_id','*',
      'card_id','00000000-0000-0000-0000-000000000001')
  ));
  select (score_components->>'calibrated_win_probability')::numeric into v_prob
    from public.award_candidate_snapshot
   where award_key='ballon_dor' and season_id=2026 and snapshot_date='2026-10-29'
     and card_id='00000000-0000-0000-0000-000000000001' and competition_id='*';
  if v_prob <> 0.42 then raise exception 'calibrated probability not persisted: %', v_prob; end if;
end $$;
