-- Run manually against a non-production database after the migration is applied.
-- Raises an exception on any incorrect settlement mapping.
do $$
begin
  if public.settle_market_pick('h2h', 'home', null, 2, 1) <> 'win' then raise exception 'h2h home win failed'; end if;
  if public.settle_market_pick('h2h', 'draw', null, 1, 1) <> 'win' then raise exception 'h2h draw failed'; end if;
  if public.settle_market_pick('totals', 'over', 2.5, 2, 1) <> 'win' then raise exception 'totals over failed'; end if;
  if public.settle_market_pick('totals', 'under', 2.5, 1, 1) <> 'win' then raise exception 'totals under failed'; end if;
  if public.settle_market_pick('totals', 'under', 2.0, 1, 1) <> 'push' then raise exception 'totals push failed'; end if;
  if public.settle_market_pick('spreads', 'home', -0.5, 2, 1) <> 'win' then raise exception 'spread home win failed'; end if;
  if public.settle_market_pick('spreads', 'home', -1.5, 2, 1) <> 'loss' then raise exception 'spread home loss failed'; end if;
  if public.settle_market_pick('btts', 'yes', null, 1, 0) <> 'loss' then raise exception 'btts no-goal failed'; end if;
  if public.settle_market_pick('draw_no_bet', 'home', null, 1, 1) <> 'push' then raise exception 'draw-no-bet push failed'; end if;
  if public.settle_market_pick('double_chance', 'home_draw', null, 1, 1) <> 'win' then raise exception 'double-chance failed'; end if;
  if public.settle_market_pick('totals', 'over', 2.25, 2, 1) <> 'unsupported_line' then raise exception 'quarter line must be unsupported'; end if;
end;
$$;
