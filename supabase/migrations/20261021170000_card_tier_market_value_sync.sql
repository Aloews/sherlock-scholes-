-- Keep the visual card tier synchronized with both recognizability and a current,
-- source-backed market valuation. The market value is a lower bound for tier,
-- never a substitute for historic achievements or fame.
--
-- Current-value tiers:
--   >= EUR 100m: epic
--   age <= 20 and >= EUR 20m, or age <= 23 and >= EUR 40m: prospect
--   >= EUR 50m: rare
-- Values older than 548 days are ignored. A manually curated icon is preserved.
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

  v_base := public.fame_tier(p_fame);

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

  -- Historic fame always wins; market value only lifts a lower tier.
  if v_base = 'legendary' then
    return 'legendary';
  elsif v_base = 'epic' or v_value_tier = 'epic' then
    return 'epic';
  elsif v_base = 'prospect' or v_value_tier = 'prospect' then
    return 'prospect';
  elsif v_base = 'rare' or v_value_tier = 'rare' then
    return 'rare';
  end if;

  return 'common';
end;
$$;

create or replace function public.sync_card_tier_from_signals()
returns trigger
language plpgsql
as $$
begin
  new.tier := public.card_tier_for_signals(
    new.category,
    new.fame,
    new.market_value_eur,
    new.market_value_at,
    new.born_on,
    new.tier
  );
  return new;
end;
$$;

drop trigger if exists cards_sync_tier_on_insert on public.cards;
drop trigger if exists cards_sync_tier_on_update on public.cards;
create trigger cards_sync_tier_on_insert
before insert on public.cards
for each row execute function public.sync_card_tier_from_signals();
create trigger cards_sync_tier_on_update
before update of tier, fame, market_value_eur, market_value_at, born_on, category
on public.cards
for each row execute function public.sync_card_tier_from_signals();

-- Repair existing stale tiers as part of rollout. The trigger also prevents a
-- later fame refresh from overwriting a stronger, still-current market signal.
update public.cards c
   set tier = public.card_tier_for_signals(
     c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.tier
   )
 where c.tier is distinct from public.card_tier_for_signals(
     c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.tier
   );

comment on function public.card_tier_for_signals(text, smallint, bigint, date, date, text)
  is 'Card tier from fame and verified current Transfermarkt market value; stale valuations are ignored.';
