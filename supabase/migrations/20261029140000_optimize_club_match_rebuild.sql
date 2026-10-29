-- Avoid a second full DISTINCT ON pass through player_match_days when rebuilding team fixtures.
-- player_match_days deduplicates by player/date, while club_match needs one row per fixture.
-- Deduplicate fixtures directly from the source table first, then resolve club aliases.
create index if not exists player_match_stats_fixture_rebuild_idx
  on public.player_match_stats (
    match_date,
    tournament,
    home_team,
    away_team,
    (minutes is not null) desc,
    home_score desc nulls last,
    away_score desc nulls last,
    source,
    card_id,
    fetched_at desc
  )
  where not disputed
    and home_score is not null
    and away_score is not null;

create or replace function public.rebuild_club_matches()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  with source_fixtures as materialized (
    select distinct on (d.match_date, d.tournament, d.home_team, d.away_team)
           d.match_date,
           d.tournament,
           d.home_team,
           d.away_team,
           d.home_score,
           d.away_score
      from public.player_match_stats d
     where not d.disputed
       and d.home_score is not null
       and d.away_score is not null
     order by d.match_date,
              d.tournament,
              d.home_team,
              d.away_team,
              (d.minutes is not null) desc,
              d.home_score desc nulls last,
              d.away_score desc nulls last,
              d.source,
              d.card_id,
              d.fetched_at desc
  ),
  mapped as materialized (
    select f.match_date,
           f.tournament,
           f.home_team,
           f.away_team,
           f.home_score,
           f.away_score,
           sh.club_key as home_key,
           sa.club_key as away_key
      from source_fixtures f
      join public.club_name_seen sh
        on sh.team = f.home_team
       and sh.scope = coalesce(public.tournament_scope(f.tournament), '')
      join public.club_name_seen sa
        on sa.team = f.away_team
       and sa.scope = coalesce(public.tournament_scope(f.tournament), '')
     where sh.club_key is not null
       and sa.club_key is not null
       and sh.club_key <> sa.club_key
       and (
         public.tournament_scope(f.tournament) is distinct from 'Россия'
         or (
           exists (
             select 1 from public.football_club fc
              where fc.club_key = sh.club_key and fc.country = 'Россия'
           )
           and exists (
             select 1 from public.football_club fc
              where fc.club_key = sa.club_key and fc.country = 'Россия'
           )
         )
       )
  ),
  resolved as (
    select distinct on (m.match_date, m.home_key, m.away_key)
           m.match_date,
           m.home_key,
           m.away_key,
           m.tournament,
           m.home_team,
           m.away_team,
           m.home_score,
           m.away_score
      from mapped m
     order by m.match_date,
              m.home_key,
              m.away_key,
              m.home_score desc nulls last,
              m.away_score desc nulls last,
              m.tournament,
              m.home_team,
              m.away_team
  )
  insert into public.club_match (
    match_date, home_key, away_key, tournament,
    home_team, away_team, home_score, away_score, fetched_at
  )
  select r.match_date,
         r.home_key,
         r.away_key,
         r.tournament,
         r.home_team,
         r.away_team,
         r.home_score,
         r.away_score,
         now()
    from resolved r
  on conflict (match_date, home_key, away_key) do update set
    tournament = excluded.tournament,
    home_team  = excluded.home_team,
    away_team  = excluded.away_team,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    fetched_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
