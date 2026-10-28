create schema if not exists public;
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  active boolean not null default true,
  tier text not null default 'common',
  fame smallint,
  market_value_eur bigint,
  market_value_at date,
  born_on date,
  facts jsonb not null default '{}'::jsonb
);
create or replace function public.fame_tier(p_fame smallint)
returns text language sql immutable as $$
  select case
    when p_fame is null then 'common'
    when p_fame >= 99 then 'legendary'
    when p_fame >= 95 then 'epic'
    when p_fame >= 75 then 'rare'
    else 'common'
  end;
$$;
