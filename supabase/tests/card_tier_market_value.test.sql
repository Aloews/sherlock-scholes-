begin;
do $$
declare
  v_khvicha uuid;
  v_elite uuid;
  v_prospect uuid;
  v_rare uuid;
  v_odegaard uuid;
  v_stale uuid;
  v_club uuid;
  v_icon uuid;
  v_checked uuid;
  v_famous_no_awards uuid;
  v_verified_legend uuid;
  v_finalist_only uuid;
begin
  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on, facts)
  values ('Khvicha regression', 'player', 99, 140000000, current_date - 30, date '2001-02-12',
          '{"honours":[{"title":"Чемпион Италии","count":1,"kind":"team"}]}'::jsonb)
  returning id into v_khvicha;
  if (select tier from public.cards where id=v_khvicha) <> 'legendary' then
    raise exception 'Khvicha-shaped card must not remain common when fame is 99';
  end if;

  insert into public.cards(name, category, fame, facts)
  values ('Famous player without verified honours', 'player', 99, '{"titles":["Трофей без подтверждения"]}'::jsonb)
  returning id into v_famous_no_awards;
  if (select tier from public.cards where id=v_famous_no_awards) <> 'rare' then
    raise exception 'fame 99 without structured verified honours must not grant legendary';
  end if;

  insert into public.cards(name, category, fame, facts)
  values ('Famous player with verified honours', 'player', 99,
          '{"honours":[{"title":"Победитель Лиги чемпионов УЕФА","count":5,"kind":"team"}]}'::jsonb)
  returning id into v_verified_legend;
  if (select tier from public.cards where id=v_verified_legend) <> 'legendary' then
    raise exception 'fame 99 with structured verified honours must remain legendary';
  end if;

  insert into public.cards(name, category, fame, facts)
  values ('Famous finalist without a win', 'player', 99,
          '{"honours":[{"title":"Финалист Лиги чемпионов УЕФА","count":3,"kind":"team"}]}'::jsonb)
  returning id into v_finalist_only;
  if (select tier from public.cards where id=v_finalist_only) <> 'rare' then
    raise exception 'finalist-only records must not grant legendary';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Current elite value', 'player', 50, 140000000, current_date - 30, date '1998-01-01')
  returning id into v_elite;
  if (select tier from public.cards where id=v_elite) <> 'epic' then
    raise exception 'current EUR 100m+ valuation must lift a player to epic';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Young prospect', 'player', 50, 60000000, current_date - 30, current_date - interval '19 years')
  returning id into v_prospect;
  if (select tier from public.cards where id=v_prospect) <> 'prospect' then
    raise exception 'young player with verified current EUR 60m valuation must be prospect';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Senior high value', 'player', 50, 60000000, current_date - 30, date '1998-01-01')
  returning id into v_rare;
  if (select tier from public.cards where id=v_rare) <> 'rare' then
    raise exception 'current EUR 50m+ valuation must lift a senior player to rare';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Odegaard rarity regression', 'player', 97, 80000000, current_date - 20, date '1998-12-17')
  returning id into v_odegaard;
  if (select tier from public.cards where id=v_odegaard) <> 'rare' then
    raise exception 'fame 97 and current EUR 80m valuation must be rare, not epic';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Stale valuation', 'player', 50, 140000000, current_date - 600, date '1998-01-01')
  returning id into v_stale;
  if (select tier from public.cards where id=v_stale) <> 'common' then
    raise exception 'stale valuation must not promote a player';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Valued club', 'club', 50, 140000000, current_date - 30, null)
  returning id into v_club;
  if (select tier from public.cards where id=v_club) <> 'common' then
    raise exception 'market value must not promote non-player cards';
  end if;

  insert into public.cards(name, category, tier, fame, market_value_eur, market_value_at, born_on)
  values ('Curated icon', 'player', 'icon', null, 140000000, current_date - 30, date '1998-01-01')
  returning id into v_icon;
  if (select tier from public.cards where id=v_icon) <> 'icon' then
    raise exception 'manually curated icon tier must be preserved';
  end if;

  update public.cards set market_value_eur=140000000, market_value_at=current_date - 30
   where id=v_stale;
  if (select tier from public.cards where id=v_stale) <> 'epic' then
    raise exception 'tier must update when a fresh valuation arrives';
  end if;

  update public.cards set fame=99 where id=v_elite;
  if (select tier from public.cards where id=v_elite) <> 'epic' then
    raise exception 'fame updates without verified honours must not override the market-value tier';
  end if;

  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Checked valuation', 'player', 50, 10000000, current_date - 30, date '1998-01-01')
  returning id into v_checked;

  perform * from public.apply_card_market_values(jsonb_build_array(jsonb_build_object(
    'card_id', v_checked::text,
    'value_eur', 5000000,
    'valued_at', (current_date - 90)::text
  )));
  if (select market_value_eur from public.cards where id=v_checked) <> 10000000
     or (select market_value_at from public.cards where id=v_checked) <> current_date - 30 then
    raise exception 'older source valuation must not overwrite a newer stored value';
  end if;
  if (select market_value_checked_at from public.cards where id=v_checked) is null then
    raise exception 'a checked profile must record the attempt even when its source date is older';
  end if;

  perform * from public.apply_card_market_values(jsonb_build_array(jsonb_build_object(
    'card_id', v_checked::text,
    'value_eur', null,
    'valued_at', null
  )));
  if (select market_value_eur from public.cards where id=v_checked) <> 10000000
     or (select market_value_at from public.cards where id=v_checked) <> current_date - 30 then
    raise exception 'a source response without a valuation date must not clear stored price data';
  end if;
end $$;
rollback;
