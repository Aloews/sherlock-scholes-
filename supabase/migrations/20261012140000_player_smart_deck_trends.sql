-- Data-driven Smart Deck trends. This does NOT discover player names with an LLM:
-- it aggregates the existing, source-ingested match table and returns canonical card IDs.
-- Duplicate source rows for the same player/day are collapsed before windowing.
create or replace function public.player_smart_deck_trends(p_limit integer default 100)
returns table (
  card_id uuid,
  name text,
  name_en text,
  photo_url text,
  country text,
  position_ru text,
  fame smallint,
  recent_matches integer,
  recent_goals integer,
  recent_assists integer,
  previous_matches integer,
  previous_goals integer,
  previous_assists integer,
  recent_points integer,
  previous_points integer,
  recent_last_match date,
  stats_collected_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with per_day as (
    select distinct on (s.card_id, s.match_date)
      s.card_id, s.match_date, s.minutes, s.goals, s.assists, s.fetched_at
    from public.player_match_stats s
    where s.match_date > current_date - 60
      and s.match_date <= current_date
      and not coalesce(s.disputed, false)
    order by s.card_id, s.match_date, (s.minutes is not null) desc, s.source, s.tournament
  ),
  source_freshness as (
    select s.card_id, max(s.fetched_at) as stats_collected_at
    from public.player_match_stats s
    where s.match_date > current_date - 60
      and s.match_date <= current_date
      and not coalesce(s.disputed, false)
    group by s.card_id
  ),
  aggregates as (
    select
      d.card_id,
      count(*) filter (where d.match_date > current_date - 30)::integer as recent_matches,
      coalesce(sum(d.goals) filter (where d.match_date > current_date - 30), 0)::integer as recent_goals,
      coalesce(sum(d.assists) filter (where d.match_date > current_date - 30), 0)::integer as recent_assists,
      count(*) filter (where d.match_date <= current_date - 30)::integer as previous_matches,
      coalesce(sum(d.goals) filter (where d.match_date <= current_date - 30), 0)::integer as previous_goals,
      coalesce(sum(d.assists) filter (where d.match_date <= current_date - 30), 0)::integer as previous_assists,
      max(d.match_date) filter (where d.match_date > current_date - 30) as recent_last_match
    from per_day d
    group by d.card_id
  )
  select
    c.id, c.name, c.name_en, c.photo_url, c.country, c.position_ru, c.fame,
    a.recent_matches, a.recent_goals, a.recent_assists,
    a.previous_matches, a.previous_goals, a.previous_assists,
    (a.recent_goals * 4 + a.recent_assists * 3)::integer,
    (a.previous_goals * 4 + a.previous_assists * 3)::integer,
    a.recent_last_match, sf.stats_collected_at
  from aggregates a
  join source_freshness sf on sf.card_id = a.card_id
  join public.cards c on c.id = a.card_id
  where c.active and c.category = 'player'
    and a.recent_matches >= 3
    and a.previous_matches >= 3
    and (a.recent_goals * 4 + a.recent_assists * 3) >= 12
    and sf.stats_collected_at >= now() - interval '72 hours'
    and (
      ((a.recent_goals * 4 + a.recent_assists * 3)::numeric / a.recent_matches)
      - ((a.previous_goals * 4 + a.previous_assists * 3)::numeric / a.previous_matches)
    ) >= 1
    and (
      (a.recent_goals * 4 + a.recent_assists * 3)::numeric / a.recent_matches
    ) >= (
      (a.previous_goals * 4 + a.previous_assists * 3)::numeric / a.previous_matches
    ) * 1.5
  order by
    (
      ((a.recent_goals * 4 + a.recent_assists * 3)::numeric / a.recent_matches)
      - ((a.previous_goals * 4 + a.previous_assists * 3)::numeric / a.previous_matches)
    ) desc,
    (a.recent_goals * 4 + a.recent_assists * 3) desc,
    c.name
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

revoke all on function public.player_smart_deck_trends(integer) from public;
grant execute on function public.player_smart_deck_trends(integer) to anon, authenticated, service_role;

comment on function public.player_smart_deck_trends(integer) is
'Deterministic Smart Deck input from existing match stats: recent 30 days versus previous 30 days. Canonical card IDs only; source rows deduplicated by player/date; disputed/future matches excluded. LLM is not used to discover players.';
