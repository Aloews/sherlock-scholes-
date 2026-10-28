-- A famous card is not automatically a legendary football card.
-- Keep manually curated icons, but require structured source-backed honours for
-- the legendary tier. Market value can still produce epic/prospect tiers.
create or replace function public.card_has_verified_honours(p_facts jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  if jsonb_typeof(p_facts->'honours') is distinct from 'array' then
    return false;
  end if;

  return exists (
    select 1
      from jsonb_array_elements(p_facts->'honours') as item(value)
     where jsonb_typeof(item.value) = 'object'
       and length(trim(coalesce(item.value->>'title', ''))) >= 3
       and coalesce((item.value->>'count')::integer, 1) >= 1
       and coalesce(item.value->>'title', '') !~* '\{\{|\}\}|\|url\s*=|https?://'
       and lower(trim(both ' «»„“”".,:;!?' from coalesce(item.value->>'title','')))
           not in ('награда', 'награды', 'награда «»')
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

create or replace function public.card_tier_for_signals(
  p_category text,
  p_fame smallint,
  p_market_value_eur bigint,
  p_market_value_at date,
  p_born_on date,
  p_facts jsonb,
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
  v_has_honours boolean := public.card_has_verified_honours(p_facts);
begin
  if p_existing_tier = 'icon' then
    return 'icon';
  end if;

  v_base := case
    when p_fame >= 99 and v_has_honours then 'legendary'
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
    new.facts,
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
before update of tier, fame, market_value_eur, market_value_at, born_on, category, facts
on public.cards
for each row execute function public.sync_card_tier_from_signals();

-- The old signature has no award evidence parameter and must not remain callable
-- as a competing source of tier decisions.
drop function if exists public.card_tier_for_signals(text, smallint, bigint, date, date, text);

update public.cards c
   set tier = public.card_tier_for_signals(
     c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.facts, c.tier
   )
 where c.tier is distinct from public.card_tier_for_signals(
     c.category, c.fame, c.market_value_eur, c.market_value_at, c.born_on, c.facts, c.tier
   );

comment on function public.card_has_verified_honours(jsonb)
  is 'True only when facts.honours contains at least one structured, non-placeholder award record.';
comment on function public.card_tier_for_signals(text, smallint, bigint, date, date, jsonb, text)
  is 'Card tier from verified structured honours, fame, and current source-backed market value; stale valuations are ignored.';
