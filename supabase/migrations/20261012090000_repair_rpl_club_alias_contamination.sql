-- Repair cross-league alias contamination discovered in production on 2026-10-12.
-- Root cause: the Russian-scope alias "Краснодар" pointed at Tianjin Jinmen Tiger.
-- That made the RPL standings aggregate Russian results under a Chinese club key.

begin;

update public.football_club
   set name = 'Тяньцзинь Цзиньмэнь',
       name_en = 'Tianjin Jinmen Tiger FC',
       country = 'Китай',
       league = 'Китай. Суперлига'
 where club_key = 'tianjin jinmen tiger';

update public.club_name_seen
   set club_key = 'krasnodar'
 where team = 'Краснодар'
   and scope = 'Россия'
   and club_key = 'tianjin jinmen tiger';

-- Remove the already-materialized bad rows; rebuild below from player_match_days
-- using the corrected, scoped aliases. Preserve actual Chinese-league matches.
delete from public.club_match
 where (home_key = 'tianjin jinmen tiger' or away_key = 'tianjin jinmen tiger')
   and (
     tournament ilike 'Россия.%'
     or tournament ilike 'Russian Premier League%'
     or tournament ilike 'Russian Cup%'
   );

create or replace function public.rebuild_club_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into club_match (match_date, home_key, away_key, tournament,
                          home_team, away_team, home_score, away_score, fetched_at)
  select distinct on (m.match_date, m.home_key, m.away_key)
         m.match_date, m.home_key, m.away_key, m.tournament,
         m.home_team, m.away_team, m.home_score, m.away_score, now()
    from (
      select d.match_date, d.tournament, d.home_team, d.away_team,
             d.home_score, d.away_score,
             sh.club_key as home_key, sa.club_key as away_key
        from player_match_days d
        join club_name_seen sh
          on sh.team = d.home_team and sh.scope = coalesce(tournament_scope(d.tournament), '')
        join club_name_seen sa
          on sa.team = d.away_team and sa.scope = coalesce(tournament_scope(d.tournament), '')
       where d.home_score is not null and d.away_score is not null
    ) m
   where m.home_key is not null and m.away_key is not null
     and m.home_key <> m.away_key
     -- A Russian competition must never resolve to a non-Russian club. This
     -- validation is deliberately scoped to the source's explicit Russia tag;
     -- other source scope vocabularies (e.g. "German 2", "Japanese J") are not
     -- country names and must not be compared to football_club.country.
     and (
       tournament_scope(m.tournament) is distinct from 'Россия'
       or (
         exists (select 1 from football_club f
                  where f.club_key = m.home_key and f.country = 'Россия')
         and
         exists (select 1 from football_club f
                  where f.club_key = m.away_key and f.country = 'Россия')
       )
     )
   order by m.match_date, m.home_key, m.away_key, m.home_score desc nulls last
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
$$;

create or replace function public.league_table(p_tournament text, p_lang text default 'ru')
returns table (
  place integer,
  club_key text,
  name text,
  crest_url text,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  goals_for integer,
  goals_against integer,
  goal_diff integer,
  points integer,
  form text
)
language sql stable
security definer
set search_path = public
as $$
  with expected as (
    select case
      when p_tournament ilike '%russian premier league%'
        or p_tournament ilike 'Россия.%' then 'Россия'
      when p_tournament ilike '%chinese super league%'
        or p_tournament ilike 'Китай.%' then 'Китай'
      else tournament_scope(p_tournament)
    end as country
  ),
  start as (
    select coalesce((select season_start from league_season where tournament = p_tournament),
                    current_date - 400) as st
  ),
  played as (
    select x.k as club_key, m.match_date,
           case when x.k = m.home_key then m.home_score else m.away_score end as gf,
           case when x.k = m.home_key then m.away_score else m.home_score end as ga
      from club_match m, start s, expected e,
      lateral (select unnest(array[m.home_key, m.away_key]) as k) x
     where m.tournament = p_tournament
       and m.match_date >= s.st
       and m.home_score is not null and m.away_score is not null
       and exists (
         select 1 from football_club f
          where f.club_key = m.home_key
            and (e.country is null or f.country = e.country)
       )
       and exists (
         select 1 from football_club f
          where f.club_key = m.away_key
            and (e.country is null or f.country = e.country)
       )
  ),
  agg as (
    select club_key,
           count(*)::int as played,
           count(*) filter (where gf > ga)::int as wins,
           count(*) filter (where gf = ga)::int as draws,
           count(*) filter (where gf < ga)::int as losses,
           sum(gf)::int as gf,
           sum(ga)::int as ga,
           (sum(gf) - sum(ga))::int as gd,
           (count(*) filter (where gf > ga) * 3
            + count(*) filter (where gf = ga))::int as pts,
           string_agg(case when gf > ga then 'w' when gf = ga then 'd' else 'l' end,
                      '' order by match_date desc) as all_form
      from played group by club_key
  )
  select row_number() over (order by a.pts desc, a.gd desc, a.gf desc, f.name)::int,
         a.club_key,
         coalesce(club_display_name(a.club_key, p_lang), f.name),
         f.crest_url,
         a.played, a.wins, a.draws, a.losses, a.gf, a.ga, a.gd, a.pts,
         left(a.all_form, 5)
    from agg a
    join football_club f on f.club_key = a.club_key
   order by a.pts desc, a.gd desc, a.gf desc, f.name
$$;

select public.rebuild_club_matches();

commit;
