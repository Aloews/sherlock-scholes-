-- Normalize duplicate Russian Premier League tournament labels before building standings.
-- The connected data contains both "Russian Premier League" (ESPN) and
-- "Россия. Премьер-лига" (sports.ru). Treating them as separate competitions
-- produced partial tables even after the foreign-club alias was corrected.

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
    end as country,
    (p_tournament ilike '%russian premier league%'
      or p_tournament = 'Россия. Премьер-лига') as is_rpl
  ),
  start as (
    select coalesce(
      (select season_start from league_season where tournament = p_tournament),
      (select season_start from league_season where tournament = 'Россия. Премьер-лига'
        and p_tournament ilike '%russian premier league%'),
      current_date - 400
    ) as st
  ),
  played as (
    select x.k as club_key, m.match_date,
           case when x.k = m.home_key then m.home_score else m.away_score end as gf,
           case when x.k = m.home_key then m.away_score else m.home_score end as ga
      from club_match m, start s, expected e,
      lateral (select unnest(array[m.home_key, m.away_key]) as k) x
     where (
       m.tournament = p_tournament
       or (e.is_rpl and m.tournament in ('Russian Premier League', 'Россия. Премьер-лига'))
     )
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
