-- A valid stats-source response is an attempt even when it returns no season rows.
-- Without this checkpoint, profiles with a definitive empty response/404 remain at
-- the head of the 800-player rotation forever and starve the rest of the catalogue.
alter table public.cards
  add column if not exists player_stats_checked_at timestamptz;

-- Do not infer an attempt from old season rows: the former collector could label
-- competition aggregates as seasons. All cards start unchecked and are advanced
-- only by a verified match-level source response.

create index if not exists cards_player_stats_refresh_queue_idx
  on public.cards (player_stats_checked_at asc nulls first, market_value_eur desc, id)
  where active is true
    and category in ('player', 'woman')
    and transfermarkt_id is not null;
