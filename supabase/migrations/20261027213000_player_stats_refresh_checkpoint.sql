-- A valid stats-source response is an attempt even when it returns no season rows.
-- Without this checkpoint, profiles with a definitive empty response/404 remain at
-- the head of the 800-player rotation forever and starve the rest of the catalogue.
alter table public.cards
  add column if not exists player_stats_checked_at timestamptz;

-- Existing current-season records provide a safe initial checkpoint. Players with
-- no current-season record remain NULL and are prioritized for their first check.
with active_season as (
  select max(season_id) as season_id from public.player_season_stat
), latest as (
  select s.card_id, max(s.fetched_at) as fetched_at
  from public.player_season_stat s
  join active_season a on a.season_id = s.season_id
  where s.card_id is not null
  group by s.card_id
)
update public.cards c
set player_stats_checked_at = latest.fetched_at
from latest
where c.id = latest.card_id
  and c.player_stats_checked_at is null
  and latest.fetched_at is not null;

create index if not exists cards_player_stats_refresh_queue_idx
  on public.cards (player_stats_checked_at asc nulls first, market_value_eur desc, id)
  where active is true
    and category in ('player', 'woman')
    and transfermarkt_id is not null;
