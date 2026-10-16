-- Separate first-time transfer collection from stale-history refresh.
-- p_stale_days <= 0 selects players with no transfer history.
-- p_stale_days > 0 selects only players whose existing history is older than the threshold.
-- This prevents the stale queue from repeatedly selecting players with no history
-- and starving players whose existing history actually needs refreshing.

create or replace function public.transfers_to_refresh(
  p_min_value bigint default 600000,
  p_stale_days integer default 0,
  p_limit integer default 150
)
returns table (
  card_id uuid,
  name_en text,
  transfermarkt_id text,
  market_value_eur bigint,
  last_fetched timestamptz
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $$
  with last_seen as (
    select t.tm_player_id, max(t.fetched_at) as seen
      from player_transfer t
     group by t.tm_player_id
  )
  select
    c.id,
    c.name_en,
    c.transfermarkt_id,
    c.market_value_eur,
    l.seen
  from cards c
  left join last_seen l on l.tm_player_id = c.transfermarkt_id
  where c.active
    and c.category = 'player'
    and c.transfermarkt_id is not null
    and c.market_value_eur >= p_min_value
    and (
      (coalesce(p_stale_days, 0) <= 0 and l.seen is null)
      or (
        p_stale_days > 0
        and l.seen is not null
        and l.seen < now() - make_interval(days => p_stale_days)
      )
    )
  order by c.market_value_eur desc nulls last
  limit greatest(coalesce(p_limit, 150), 1);
$$;

comment on function public.transfers_to_refresh(bigint, integer, integer) is
  'p_stale_days <= 0 selects players without transfer history; positive values select only existing histories older than the threshold.';

revoke all on function public.transfers_to_refresh(bigint, integer, integer) from public;
grant execute on function public.transfers_to_refresh(bigint, integer, integer) to service_role;
