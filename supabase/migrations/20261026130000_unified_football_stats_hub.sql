-- Unified football statistics read layer.
-- Existing source tables remain intact; this migration adds shared read contracts.
-- player_season_stat contains provider rows whose season_id may represent a provider
-- grouping rather than a verified calendar season. Career views therefore aggregate
-- across competition/club and do not expose season_id as a verified season grain.

create or replace view public.player_stats_freshness
with (security_invoker = true) as
select tm_player_id,
       max(fetched_at) as latest_fetched_at,
       count(*)::integer as source_rows
  from public.player_season_stat
 group by tm_player_id;

create or replace view public.football_player_competition_totals
with (security_invoker = true) as
with ranked as (
  select s.*,
         row_number() over (
           partition by s.tm_player_id, s.competition_id, s.club_id
           order by s.fetched_at desc, s.season_id desc
         ) as freshness_rank,
         count(*) over (
           partition by s.tm_player_id, s.competition_id, s.club_id
         )::integer as source_rows
    from public.player_season_stat s
)
select card_id,
       tm_player_id,
       competition_id,
       club_id,
       apps::integer as appearances,
       starts::integer as starts,
       minutes::bigint as minutes,
       goals::integer as goals,
       assists::integer as assists,
       own_goals::integer as own_goals,
       penalty_goals::integer as penalty_goals,
       yellow::integer as yellow_cards,
       yellow_red::integer as second_yellow_red_cards,
       red::integer as red_cards,
       fetched_at as last_fetched_at,
       source_rows
  from ranked
 where freshness_rank = 1;

create or replace view public.football_player_career_totals
with (security_invoker = true) as
select x.card_id,
       x.tm_player_id,
       (sum(x.appearances) filter (where not coalesce(k.is_national_team, false)))::integer as club_appearances,
       (sum(x.goals) filter (where not coalesce(k.is_national_team, false)))::integer as club_goals,
       (sum(x.assists) filter (where not coalesce(k.is_national_team, false)))::integer as club_assists,
       (sum(x.minutes) filter (where not coalesce(k.is_national_team, false)))::bigint as club_minutes,
       (count(distinct x.club_id) filter (where not coalesce(k.is_national_team, false)))::integer as club_count,
       (sum(x.appearances) filter (where coalesce(k.is_national_team, false)))::integer as national_appearances_all_levels,
       (sum(x.goals) filter (where coalesce(k.is_national_team, false)))::integer as national_goals_all_levels,
       max(x.last_fetched_at) as last_fetched_at
  from public.football_player_competition_totals x
  left join public.tm_club k on k.id = x.club_id
 group by x.card_id, x.tm_player_id;

comment on view public.player_stats_freshness is
  'Latest successful source-row fetch per Transfermarkt player ID; used for freshness-aware scheduling.';
comment on view public.football_player_competition_totals is
  'Latest provider aggregate by player, club and competition. Does not claim that provider season_id is a verified season; duplicate groupings resolve to the latest fetch.';
comment on view public.football_player_career_totals is
  'Canonical club and national-team career totals from the shared competition totals layer. Youth and senior national teams remain combined here; use the detailed view when separation is required.';

grant select on public.player_stats_freshness,
                public.football_player_competition_totals,
                public.football_player_career_totals
to anon, authenticated, service_role;

-- Keep the existing RPC contract, but route its numerical totals through the
-- shared canonical layer rather than re-aggregating the raw provider rows.
drop function if exists public.player_club_career(uuid);
create function public.player_club_career(p_card_id uuid)
returns table (
  club_id text,
  club_name text,
  season_from smallint,
  season_to smallint,
  apps integer,
  goals integer,
  assists integer,
  minutes bigint
)
language sql stable security definer set search_path = public as $$
  select x.club_id,
         coalesce(k.name, x.club_id),
         null::smallint,
         null::smallint,
         sum(x.appearances)::integer,
         sum(x.goals)::integer,
         sum(x.assists)::integer,
         sum(x.minutes)::bigint
    from public.football_player_competition_totals x
    left join public.tm_club k on k.id = x.club_id
   where x.card_id = p_card_id
     and not coalesce(k.is_national_team, false)
   group by x.club_id, coalesce(k.name, x.club_id)
   order by max(x.last_fetched_at) desc, sum(x.appearances) desc;
$$;
revoke all on function public.player_club_career(uuid) from public;
grant execute on function public.player_club_career(uuid) to anon, authenticated, service_role;

drop function if exists public.player_career_totals(uuid);
create function public.player_career_totals(p_card_id uuid)
returns table (
  club_apps integer,
  club_goals integer,
  club_assists integer,
  club_minutes bigint,
  club_count integer,
  season_from smallint,
  season_to smallint,
  national_apps integer,
  national_goals integer,
  national_team text,
  leagues integer,
  countries integer
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select x.*, coalesce(k.is_national_team, false) as nat,
           k.name as club_name, t.type_id, t.country_id
      from public.football_player_competition_totals x
      left join public.tm_club k on k.id = x.club_id
      left join public.tm_competition t on t.id = x.competition_id
     where x.card_id = p_card_id
  ),
  totals as (
    select * from public.football_player_career_totals
     where card_id = p_card_id
  ),
  team as (
    select r.club_name, sum(r.appearances)::integer as apps, sum(r.goals)::integer as goals
      from rows r
     where r.nat and r.club_name is not null
     group by r.club_name
     order by sum(r.appearances) desc
     limit 1
  )
  select coalesce(t.club_appearances, 0),
         coalesce(t.club_goals, 0),
         coalesce(t.club_assists, 0),
         coalesce(t.club_minutes, 0),
         coalesce(t.club_count, 0),
         null::smallint,
         null::smallint,
         coalesce((select apps from team), 0),
         coalesce((select goals from team), 0),
         (select club_name from team),
         count(distinct r.competition_id) filter (where not r.nat and r.type_id between 1 and 6)::integer,
         count(distinct r.country_id) filter (where not r.nat and r.country_id > 0)::integer
    from rows r
    left join totals t on t.card_id = r.card_id
   group by t.club_appearances, t.club_goals, t.club_assists, t.club_minutes, t.club_count;
$$;
revoke all on function public.player_career_totals(uuid) from public;
grant execute on function public.player_career_totals(uuid) to anon, authenticated, service_role;
