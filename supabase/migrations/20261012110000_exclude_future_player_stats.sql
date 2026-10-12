-- Exclude scheduled fixtures from player performance statistics.
-- sports.ru includes future fixtures on some player stat pages. Keep those
-- rows so the next crawl can update them after the match, but never treat them
-- as played matches in ratings, freshness, or card dossier totals.

create or replace function public.player_ratings(
  p_days integer default 7,
  p_limit integer default 50
)
returns table (
  card_id uuid,
  name text,
  name_en text,
  photo_url text,
  country text,
  club text,
  matches integer,
  minutes integer,
  goals integer,
  assists integer,
  points integer
)
language sql stable
as $$
  with per_day as (
    select distinct on (s.card_id, s.match_date)
      s.card_id, s.match_date, s.minutes, s.goals, s.assists
    from public.player_match_stats s
    where s.match_date > current_date - greatest(1, least(coalesce(p_days, 7), 3650))
      and s.match_date <= current_date
      and not s.disputed
    order by s.card_id, s.match_date, (s.minutes is not null) desc, s.source
  )
  select
    c.id, c.name, c.name_en, c.photo_url, c.country, cc.club,
    count(*)::integer,
    sum(s.minutes)::integer,
    coalesce(sum(s.goals), 0)::integer,
    coalesce(sum(s.assists), 0)::integer,
    (coalesce(sum(s.goals), 0) * 4 + coalesce(sum(s.assists), 0) * 3)::integer
  from per_day s
  join public.cards c on c.id = s.card_id and c.active
  left join public.card_current_club cc on cc.card_id = c.id
  group by c.id, c.name, c.name_en, c.photo_url, c.country, cc.club
  having coalesce(sum(s.goals), 0) + coalesce(sum(s.assists), 0) > 0
  order by 11 desc, 9 desc, 8 asc nulls last, c.name asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.player_stats_freshness()
returns table (
  first_match date,
  last_match date,
  collected_at timestamptz,
  players integer,
  matches integer
)
language sql stable
as $$
  select
    min(s.match_date),
    max(s.match_date),
    max(s.fetched_at),
    count(distinct s.card_id)::integer,
    count(*)::integer
  from public.player_match_stats s
  where s.match_date <= current_date
    and not s.disputed;
$$;

create or replace function public.player_collected_totals(p_card_id uuid)
returns table (
  tournament text,
  matches integer,
  minutes integer,
  goals integer,
  assists integer,
  yellow integer,
  red integer,
  first_match date,
  last_match date
)
language sql stable
as $$
  with per_day as (
    select distinct on (s.match_date)
      s.match_date, s.tournament, s.minutes, s.goals, s.assists, s.yellow, s.red
    from public.player_match_stats s
    where s.card_id = p_card_id
      and s.match_date <= current_date
      and not s.disputed
    order by s.match_date, (s.minutes is not null) desc, s.source
  )
  select
    s.tournament,
    count(*)::integer,
    sum(s.minutes)::integer,
    coalesce(sum(s.goals), 0)::integer,
    coalesce(sum(s.assists), 0)::integer,
    coalesce(sum(s.yellow), 0)::integer,
    coalesce(sum(s.red), 0)::integer,
    min(s.match_date),
    max(s.match_date)
  from per_day s
  group by s.tournament
  order by count(*) desc, max(s.match_date) desc;
$$;

grant execute on function public.player_ratings(integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.player_stats_freshness()
  to anon, authenticated, service_role;
grant execute on function public.player_collected_totals(uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
