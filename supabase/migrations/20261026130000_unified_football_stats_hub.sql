-- Unified football statistics read layer.
-- Existing source tables remain intact; this migration adds shared read contracts.
-- player_season_stat contains provider rows whose season_id may represent a provider
-- grouping rather than a verified calendar season. Career views therefore aggregate
-- across competition/club and do not expose season_id as a verified season grain.

create table if not exists public.player_season_competition_stats (
  tm_player_id text not null,
  season_id smallint not null,
  competition_id text not null,
  competition_name text,
  card_id uuid,
  apps smallint not null default 0,
  possible_games smallint,
  goals smallint not null default 0,
  assists smallint not null default 0,
  minutes integer not null default 0,
  yellow smallint not null default 0,
  yellow_red smallint not null default 0,
  red smallint not null default 0,
  start_eleven_percent numeric(5,2),
  minutes_played_percent numeric(6,2),
  goals_contributed_percent numeric(6,2),
  goalkeeper boolean,
  source_url text not null,
  source_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (tm_player_id, season_id, competition_id)
);
create index if not exists player_season_competition_card_idx
  on public.player_season_competition_stats(card_id, season_id desc);
alter table public.player_season_competition_stats enable row level security;
drop policy if exists player_season_competition_stats_read on public.player_season_competition_stats;
create policy player_season_competition_stats_read
  on public.player_season_competition_stats for select using (true);
grant select on public.player_season_competition_stats to anon, authenticated, service_role;
grant all on public.player_season_competition_stats to service_role;

create table if not exists public.player_stats_source_state (
  tm_player_id text not null,
  source_key text not null,
  last_attempt_at timestamptz not null default now(),
  status text not null check (status in ('ok','empty','error')),
  rows_written integer not null default 0,
  last_error text,
  primary key (tm_player_id, source_key)
);
alter table public.player_stats_source_state enable row level security;
revoke all on public.player_stats_source_state from public, anon, authenticated;
grant all on public.player_stats_source_state to service_role;

create or replace view public.player_stats_freshness
with (security_invoker = true) as
with career as (
  select tm_player_id, max(fetched_at) as latest_at, count(*)::integer as source_rows
    from public.player_season_stat group by tm_player_id
), season as (
  select tm_player_id, max(fetched_at) as latest_at, count(*)::integer as source_rows
    from public.player_season_competition_stats group by tm_player_id
), state_latest as (
  select distinct on (tm_player_id, source_key)
         tm_player_id, source_key, last_attempt_at, status
    from public.player_stats_source_state
   order by tm_player_id, source_key, last_attempt_at desc
), state as (
  select tm_player_id,
         max(last_attempt_at) filter (
           where source_key='tm_career_competition' and status in ('ok','empty')
         ) as career_attempt_at,
         bool_or(status='error') filter (
           where source_key='tm_career_competition'
         ) as career_error,
         max(last_attempt_at) filter (
           where source_key='tm_season_competition' and status in ('ok','empty')
         ) as season_attempt_at,
         bool_or(status='error') filter (
           where source_key='tm_season_competition'
         ) as season_error
    from state_latest group by tm_player_id
), all_ids as (
  select tm_player_id from career
  union select tm_player_id from season
  union select tm_player_id from state
), resolved as (
  select ids.tm_player_id,
         case when coalesce(st.career_error,false) then null
              else greatest(c.latest_at, st.career_attempt_at) end as career_at,
         case when coalesce(st.season_error,false) then null
              else greatest(s.latest_at, st.season_attempt_at) end as season_at,
         coalesce(c.source_rows,0)+coalesce(s.source_rows,0) as source_rows
    from all_ids ids
    left join career c using (tm_player_id)
    left join season s using (tm_player_id)
    left join state st using (tm_player_id)
)
select tm_player_id,
       case when career_at is null or season_at is null then null
            else least(career_at, season_at) end as latest_fetched_at,
       career_at as latest_career_fetched_at,
       season_at as latest_season_fetched_at,
       source_rows
  from resolved;

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

create or replace view public.football_player_stats
with (security_invoker = true) as
select 'competition_career'::text as grain,
       x.card_id, x.tm_player_id, null::smallint as season_id,
       x.competition_id, x.club_id, null::date as match_date,
       t.name as tournament, null::text as home_team, null::text as away_team,
       null::smallint as home_score, null::smallint as away_score,
       x.appearances, x.starts, x.minutes::integer as minutes,
       x.goals, x.assists, x.own_goals, x.penalty_goals,
       x.yellow_cards, x.second_yellow_red_cards, x.red_cards,
       'transfermarkt'::text as source, false as disputed,
       x.last_fetched_at as fetched_at,
       null::smallint as possible_games, null::numeric as start_eleven_percent,
       null::numeric as minutes_played_percent, null::numeric as goals_contributed_percent,
       null::boolean as goalkeeper, null::text as source_url, null::jsonb as source_payload
  from public.football_player_competition_totals x
  left join public.tm_competition t on t.id = x.competition_id
union all
select 'season_competition'::text as grain,
       s.card_id, s.tm_player_id, s.season_id,
       s.competition_id, null::text as club_id, null::date as match_date,
       coalesce(t.name,s.competition_name,s.competition_id) as tournament, null::text as home_team, null::text as away_team,
       null::smallint as home_score, null::smallint as away_score,
       s.apps::integer as appearances, null::integer as starts,
       s.minutes::integer as minutes, s.goals::integer as goals,
       s.assists::integer as assists, null::integer as own_goals,
       null::integer as penalty_goals, s.yellow::integer as yellow_cards,
       s.yellow_red::integer as second_yellow_red_cards, s.red::integer as red_cards,
       'transfermarkt_ceapi'::text as source, false as disputed, s.fetched_at,
       s.possible_games, s.start_eleven_percent, s.minutes_played_percent,
       s.goals_contributed_percent, s.goalkeeper, s.source_url, s.source_payload
  from public.player_season_competition_stats s
  left join public.tm_competition t on t.id = s.competition_id
union all
select 'match'::text as grain,
       m.card_id, c.transfermarkt_id as tm_player_id, null::smallint as season_id,
       null::text as competition_id, null::text as club_id, m.match_date,
       m.tournament, m.home_team, m.away_team, m.home_score, m.away_score,
       1::integer as appearances, null::integer as starts,
       m.minutes::integer as minutes, m.goals::integer as goals,
       m.assists::integer as assists, null::integer as own_goals,
       null::integer as penalty_goals, m.yellow::integer as yellow_cards,
       null::integer as second_yellow_red_cards, m.red::integer as red_cards,
       m.source, m.disputed, m.fetched_at,
       null::smallint as possible_games, null::numeric as start_eleven_percent,
       null::numeric as minutes_played_percent, null::numeric as goals_contributed_percent,
       null::boolean as goalkeeper, null::text as source_url, null::jsonb as source_payload
  from public.player_match_stats m
  left join public.cards c on c.id = m.card_id;

-- Keep the legacy read contract while routing rating/fantasy consumers through
-- the shared canonical facts layer. Deterministic tie-breakers match the existing
-- production rule so this migration does not change which duplicate wins.
create or replace view public.player_match_days as
  select distinct on (card_id, match_date)
         card_id, match_date, tournament, home_team, away_team,
         home_score, away_score, minutes::smallint as minutes,
         goals::smallint as goals, assists::smallint as assists,
         yellow_cards::smallint as yellow, red_cards::smallint as red, source
    from public.football_player_stats s
   where s.grain = 'match' and not s.disputed
   order by card_id, match_date,
            (minutes is not null) desc,
            source,
            tournament, home_team, away_team,
            goals desc, assists desc;

create or replace function public.apply_player_season_competition_stats(
  p_tm_id text, p_rows jsonb, p_status text
)
returns table (written integer, linked integer, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_written integer := 0;
  v_card uuid;
  v_status text := case when p_status in ('ok','empty','error') then p_status else 'error' end;
begin
  select id into v_card from public.cards
   where transfermarkt_id = p_tm_id and active and category = 'player'
   limit 1;

  if v_status = 'ok' then
    with src as (
      select distinct on (r->>'season_id', r->>'competition_id')
        (r->>'season_id')::smallint as season_id,
        r->>'competition_id' as competition_id,
        nullif(r->>'competition_name','') as competition_name,
        coalesce((r->>'apps')::smallint,0) as apps,
        nullif(r->>'possible_games','')::smallint as possible_games,
        coalesce((r->>'goals')::smallint,0) as goals,
        coalesce((r->>'assists')::smallint,0) as assists,
        coalesce((r->>'minutes')::integer,0) as minutes,
        coalesce((r->>'yellow')::smallint,0) as yellow,
        coalesce((r->>'yellow_red')::smallint,0) as yellow_red,
        coalesce((r->>'red')::smallint,0) as red,
        nullif(r->>'start_eleven_percent','')::numeric(5,2) as start_eleven_percent,
        nullif(r->>'minutes_played_percent','')::numeric(6,2) as minutes_played_percent,
        nullif(r->>'goals_contributed_percent','')::numeric(6,2) as goals_contributed_percent,
        nullif(r->>'goalkeeper','')::boolean as goalkeeper,
        coalesce(nullif(r->>'source_url',''),
          'https://www.transfermarkt.com/ceapi/player/' || p_tm_id || '/performance') as source_url,
        coalesce(r->'source_payload','{}'::jsonb) as source_payload
      from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
      where coalesce(r->>'season_id','') <> ''
        and coalesce(r->>'competition_id','') <> ''
        and coalesce(r->>'apps','') <> ''
        and coalesce(r->>'goals','') <> ''
        and coalesce(r->>'assists','') <> ''
        and coalesce(r->>'minutes','') <> ''
      order by r->>'season_id', r->>'competition_id'
    ), ins as (
      insert into public.player_season_competition_stats (
        tm_player_id, season_id, competition_id, competition_name, card_id, apps, possible_games,
        goals, assists, minutes, yellow, yellow_red, red, start_eleven_percent,
        minutes_played_percent, goals_contributed_percent, goalkeeper,
        source_url, source_payload, fetched_at
      )
      select p_tm_id, season_id, competition_id, competition_name, v_card, apps, possible_games,
        goals, assists, minutes, yellow, yellow_red, red, start_eleven_percent,
        minutes_played_percent, goals_contributed_percent, goalkeeper,
        source_url, source_payload, now()
      from src
      on conflict (tm_player_id, season_id, competition_id) do update set
        competition_name=excluded.competition_name, card_id=excluded.card_id,
        apps=excluded.apps, possible_games=excluded.possible_games,
        goals=excluded.goals, assists=excluded.assists, minutes=excluded.minutes,
        yellow=excluded.yellow, yellow_red=excluded.yellow_red, red=excluded.red,
        start_eleven_percent=excluded.start_eleven_percent,
        minutes_played_percent=excluded.minutes_played_percent,
        goals_contributed_percent=excluded.goals_contributed_percent,
        goalkeeper=excluded.goalkeeper, source_url=excluded.source_url,
        source_payload=excluded.source_payload, fetched_at=now()
      returning 1
    )
    select count(*) into v_written from ins;
    if v_written = 0 then v_status := 'error'; end if;
  end if;

  insert into public.player_stats_source_state
    (tm_player_id,source_key,last_attempt_at,status,rows_written,last_error)
  values
    (p_tm_id,'tm_season_competition',now(),v_status,v_written,
     case when v_status='error' then 'invalid_or_failed_payload' else null end)
  on conflict (tm_player_id,source_key) do update set
    last_attempt_at=now(), status=excluded.status,
    rows_written=excluded.rows_written, last_error=excluded.last_error;

  return query select v_written, (case when v_card is null then 0 else 1 end), v_status;
end;
$$;
revoke all on function public.apply_player_season_competition_stats(text,jsonb,text) from public;
grant execute on function public.apply_player_season_competition_stats(text,jsonb,text) to service_role;

create or replace function public.apply_player_stats_bundle(
  p_tm_id text,
  p_career_rows jsonb,
  p_season_rows jsonb,
  p_career_status text,
  p_season_status text
)
returns table (
  career_written integer,
  season_written integer,
  linked integer,
  career_status text,
  season_status text
)
language plpgsql security definer set search_path = public as $$
declare
  v_career_written integer := 0;
  v_season_written integer := 0;
  v_linked integer := 0;
  v_card uuid;
  v_career_status text := case when p_career_status in ('ok','empty','error') then p_career_status else 'error' end;
  v_season_status text;
begin
  if v_career_status = 'ok' then
    select r.written, r.linked into v_career_written, v_linked
      from public.apply_player_season_stats(p_tm_id, coalesce(p_career_rows,'[]'::jsonb)) r;
    if v_career_written = 0 then v_career_status := 'error'; end if;
  else
    select id into v_card from public.cards
     where transfermarkt_id=p_tm_id and active and category='player' limit 1;
    v_linked := case when v_card is null then 0 else 1 end;
  end if;

  insert into public.player_stats_source_state
    (tm_player_id,source_key,last_attempt_at,status,rows_written,last_error)
  values
    (p_tm_id,'tm_career_competition',now(),v_career_status,v_career_written,
     case when v_career_status='error' then 'invalid_or_failed_payload' else null end)
  on conflict (tm_player_id,source_key) do update set
    last_attempt_at=now(), status=excluded.status,
    rows_written=excluded.rows_written, last_error=excluded.last_error;

  select r.written, r.status into v_season_written, v_season_status
    from public.apply_player_season_competition_stats(
      p_tm_id, coalesce(p_season_rows,'[]'::jsonb), p_season_status
    ) r;

  return query select v_career_written, v_season_written, v_linked,
                      v_career_status, v_season_status;
end;
$$;
revoke all on function public.apply_player_stats_bundle(text,jsonb,jsonb,text,text) from public;
grant execute on function public.apply_player_stats_bundle(text,jsonb,jsonb,text,text) to service_role;

comment on view public.player_stats_freshness is
  'Latest successful source-row fetch per Transfermarkt player ID; used for freshness-aware scheduling.';
comment on view public.football_player_competition_totals is
  'Latest provider aggregate by player, club and competition. Does not claim that provider season_id is a verified season; duplicate groupings resolve to the latest fetch.';
comment on view public.football_player_career_totals is
  'Canonical club and national-team career totals from the shared competition totals layer. Youth and senior national teams remain combined here; use the detailed view when separation is required.';

grant select on public.player_stats_freshness to service_role;
grant select on public.football_player_competition_totals,
                public.football_player_career_totals,
                public.football_player_stats
to anon, authenticated, service_role;

-- Keep the existing RPC contract, but route its numerical totals through the
-- shared canonical layer rather than re-aggregating the raw provider rows.
create or replace function public.player_club_career(p_card_id uuid)
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

create or replace function public.player_career_totals(p_card_id uuid)
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


-- Route production analytics through the canonical match-grain view.
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
security invoker
set search_path = public
as $$
  with per_day as (
    select distinct on (s.card_id, s.match_date)
      s.card_id, s.match_date, s.home_team, s.away_team, s.tournament, s.source, s.minutes, s.goals, s.assists, s.fetched_at
    from public.football_player_stats s
    where s.grain = 'match'
      and s.match_date > current_date - 60
      and s.match_date <= current_date
      and not coalesce(s.disputed, false)
    order by s.card_id, s.match_date, (s.minutes is not null) desc, s.source, s.tournament, s.home_team, s.away_team, s.goals desc, s.assists desc
  ),
  source_freshness as (
    select s.card_id, max(s.fetched_at) as stats_collected_at
    from public.football_player_stats s
    where s.grain = 'match'
      and s.match_date > current_date - 60
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

revoke all on function public.player_smart_deck_trends(integer) from public;
grant execute on function public.player_smart_deck_trends(integer) to anon, authenticated, service_role;

create or replace function public.player_spotlight_scored(p_days integer default 365)
returns table (
  card_id          uuid,
  name             text,
  name_en          text,
  photo_url        text,
  club_key         text,
  league           text,
  age              integer,
  band             text,
  player_position  text,
  attention        numeric,
  output           numeric,
  apps             integer,
  minutes          integer,
  goals            integer,
  assists          integer,
  market_value_eur bigint,
  pageviews        integer,
  peers            integer
)
language sql stable security definer set search_path = public
set statement_timeout to '30s'
as $$
  with played as (
    select s.card_id,
           count(*)::int as apps,
           -- ⚠️ МИНУТЫ — ДОБАВКА, А НЕ ОСНОВА. Из 85 684 строк статистики за
           -- год минуты заполнены в 43 984, то есть у половины их нет. Игровое
           -- время меряется ЧИСЛОМ МАТЧЕЙ, которое есть всегда; минуты идут на
           -- экран как уточнение и не участвуют в сравнении.
           nullif(sum(coalesce(s.minutes, 0)), 0)::int as minutes,
           sum(coalesce(s.goals, 0))::int   as goals,
           sum(coalesce(s.assists, 0))::int as assists
      from public.football_player_stats s
     where s.grain = 'match'
       and s.match_date >= current_date - greatest(coalesce(p_days, 365), 30)
     group by s.card_id
  ),
  base as (
    select c.id, c.name, c.name_en, c.photo_url, c.market_value_eur, c.pageviews,
           cc.club_key, fc.league,
           extract(year from age(c.born_on))::int as age,
           case when extract(year from age(c.born_on)) <= 19 then 'u19'
                when extract(year from age(c.born_on)) <= 23 then 'u23'
                when extract(year from age(c.born_on)) <= 28 then 'prime'
                else 'senior' end as band,
           -- ⚠️ АМПЛУА ОБЯЗАТЕЛЬНО, И ЭТО НЕ ПРИДИРКА. Без него у вратаря и
           -- защитника голы структурно равны нулю, и КАЖДЫЙ вратарь попадал в
           -- список «о нём пишут больше, чем он играет». Так и вышло в первом
           -- прогоне: Диогу Кошта и Диант Рамай, оба вратари, стояли в первой
           -- пятёрке. Список, обвиняющий человека за то, что он вратарь, —
           -- это не измерение.
           pos.position as player_position,
           p.apps, p.minutes, p.goals, p.assists
      from cards c
      join card_current_club cc on cc.card_id = c.id
      join football_club fc on fc.club_key = cc.club_key
      -- ⚠️ INNER JOIN, А НЕ LEFT. Статистика матчей собрана у 9 348 игроков из
      -- 25 508; у остальных ноль означает «не собрали», а не «не играл». Первая
      -- версия звала left join — и первые восемь строк оказались игроками с
      -- нулём минут, среди них Эсекьель Барко, который весь год играет. Это был
      -- список дыр в нашем сборе, и он называл людей в лицо.
      join played p on p.card_id = c.id
      join card_position pos on pos.card_id = c.id
     where c.active and c.category = 'player'
       and c.born_on is not null
       and c.market_value_eur is not null
       and c.pageviews is not null
       and fc.league is not null and fc.league <> ''
  ),
  -- ⚠️ СРАВНЕНИЕ ТОЛЬКО ВНУТРИ ЛИГИ, ВОЗРАСТА И АМПЛУА. Деньги и внимание
  -- различаются между лигами на порядки; юниор и ветеран несравнимы по
  -- игровому времени; вратарь и нападающий — по голам.
  ranked as (
    select b.*,
           count(*) over w as peers,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.market_value_eur) as r_value,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.pageviews)        as r_views,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.apps)             as r_apps,
           percent_rank() over (partition by b.league, b.band, b.player_position order by (b.goals + b.assists)) as r_ga
      from base b
    window w as (partition by b.league, b.band, b.player_position)
  )
  select r.id, r.name, r.name_en, r.photo_url, r.club_key, r.league,
         r.age, r.band, r.player_position,
         round(((r.r_value + r.r_views) / 2)::numeric, 3),
         round(((r.r_apps  + r.r_ga)    / 2)::numeric, 3),
         r.apps, r.minutes, r.goals, r.assists,
         r.market_value_eur, r.pageviews, r.peers::int
    from ranked r
   -- Меньше восьми ровесников того же амплуа в лиге — перцентиль считать
   -- не из чего.
   where r.peers >= 8
$$;

revoke all on function public.player_spotlight_scored(integer) from public;
grant execute on function public.player_spotlight_scored(integer) to service_role;

revoke all on function public.player_spotlight_scored(integer) from public;
grant execute on function public.player_spotlight_scored(integer) to service_role;
