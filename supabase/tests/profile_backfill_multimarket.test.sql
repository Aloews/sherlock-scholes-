-- Run after migration 20261014140000_profile_backfill_multimarket_finetune.sql.
begin;
do $$
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
end $$;
rollback;
