begin;
do $$
declare
  v_khvicha uuid;
  v_elite uuid;
  v_prospect uuid;
  v_rare uuid;
  v_stale uuid;
  v_club uuid;
  v_icon uuid;
begin
  insert into public.cards(name, category, fame, market_value_eur, market_value_at, born_on)
  values ('Khvicha regression', 'player', 99, 140000000, current_date - 30, date '2001-02-12')
  returning id into v_khvicha;
  if (select tier from public.cards where id=v_khvicha) <> 'legendary' then
    raise exception 'Khvicha-shaped card must not remain common when fame is 99';
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
  if (select tier from public.cards where id=v_elite) <> 'legendary' then
    raise exception 'fame updates must keep tier synchronized';
  end if;
end $$;
rollback;
