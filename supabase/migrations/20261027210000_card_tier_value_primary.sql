-- Current elite rarity must be justified by a current, dated market valuation.
-- Fame remains a floor for recognisable cards (rare at 75+); only fame 99+
-- preserves legendary without price evidence. A manually curated icon is immutable.
-- This prevents a player with fame 97 and a EUR 80m valuation from being epic
-- solely because of popularity, while preserving elite value and young-prospect tiers.

create or replace function public.card_tier_for_signals(
  p_category text,
  p_fame smallint,
  p_market_value_eur bigint,
  p_market_value_at date,
  p_born_on date,
  p_existing_tier text
)
returns text
language plpgsql
stable
as $$
declare
  v_base text;
  v_value_tier text := 'common';
  v_age integer;
begin
  if p_existing_tier = 'icon' then
    return 'icon';
  end if;

  v_base := case
    when p_fame is null then 'common'
    when p_fame >= 99 then 'legendary'
    when p_fame >= 75 then 'rare'
    else 'common'
  end;

  if p_category not in ('player', 'woman')
     or p_market_value_eur is null
     or p_market_value_at is null
     or p_market_value_at > current_date
     or p_market_value_at < current_date - 548 then
    return v_base;
  end if;

  if p_born_on is not null then
    v_age := extract(year from age(current_date, p_born_on))::integer;
  end if;

  if p_market_value_eur >= 100000000 then
    v_value_tier := 'epic';
  elsif v_age between 16 and 20 and p_market_value_eur >= 20000000 then
    v_value_tier := 'prospect';
  elsif v_age between 21 and 23 and p_market_value_eur >= 40000000 then
    v_value_tier := 'prospect';
  elsif p_market_value_eur >= 50000000 then
    v_value_tier := 'rare';
  end if;

  if v_base = 'legendary' then
    return 'legendary';
  elsif v_value_tier = 'epic' then
    return 'epic';
  elsif v_value_tier = 'prospect' then
    return 'prospect';
  elsif v_base = 'rare' or v_value_tier = 'rare' then
    return 'rare';
  end if;

  return 'common';
end;
$$;

-- Recompute stored tiers using the same rule as future inserts/updates.
update public.cards c
set tier = public.card_tier_for_signals(
  c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.tier
)
where c.tier is distinct from public.card_tier_for_signals(
  c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.tier
);
