begin;
do $$
declare
  v_card uuid;
  v_today date := current_date;
  v_row record;
begin
  insert into public.cards(name, category, active, born_on, market_value_eur, market_value_at, facts)
  values (
    'Young market watch regression', 'player', true, current_date - interval '19 years',
    10000000, current_date,
    '{"honours":[{"title":"Победитель Лиги чемпионов УЕФА","count":2,"kind":"team"}]}'::jsonb
  )
  returning id into v_card;

  insert into public.young_talent_market_snapshot(
    snapshot_date, card_id, player_name, age, market_value_eur, market_value_at,
    verified_honours_count, verified_award_wins, base_score, score_components,
    source_url, model_version
  ) values
    (v_today - 1, v_card, 'Young market watch regression', 19, 10000000, v_today - 1,
     1, 2, 40, '{"verified_award_wins": 2}'::jsonb, 'https://www.transfermarkt.com/spieler/profil/spieler/123', 'test'),
    (v_today, v_card, 'Young market watch regression', 19, 15000000, v_today,
     1, 2, 45, '{"verified_award_wins": 2}'::jsonb, 'https://www.transfermarkt.com/spieler/profil/spieler/123', 'test');

  select * into v_row
    from public.young_talent_market_watch
   where card_id = v_card and snapshot_date = v_today;

  if v_row.previous_market_value_eur <> 10000000 then
    raise exception 'young talent watch must compare with the previous snapshot';
  end if;
  if v_row.price_change_pct <> 50 then
    raise exception 'young talent watch must calculate source-value change, got %', v_row.price_change_pct;
  end if;
  if v_row.score <= 45 then
    raise exception 'positive market momentum must increase the base score';
  end if;
  if v_row.verified_award_wins <> 2 then
    raise exception 'verified career award wins must be retained';
  end if;
  if v_row.confidence <> 'medium' then
    raise exception 'two snapshots with current price but no fresh season stats should be medium confidence, got %', v_row.confidence;
  end if;
end $$;
rollback;
