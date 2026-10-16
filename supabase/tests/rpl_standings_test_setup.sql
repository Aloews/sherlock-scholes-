-- Minimal, isolated fixture schema for RPL standings regression.
create table public.football_club (
  club_key text primary key,
  name text not null,
  country text not null,
  crest_url text
);
create table public.club_match (
  id bigserial primary key,
  tournament text not null,
  match_date date not null,
  home_key text not null,
  away_key text not null,
  home_score integer,
  away_score integer
);
create table public.league_season (
  tournament text primary key,
  season_start date not null
);
create function public.tournament_scope(text) returns text
language sql immutable as $$ select case when $1 ilike '%russian%' or $1 ilike 'Россия.%' then 'Россия' when $1 ilike '%chinese%' or $1 ilike 'Китай.%' then 'Китай' else null end $$;
create function public.club_display_name(text, text) returns text
language sql stable as $$ select name from public.football_club where club_key = $1 $$;

insert into public.league_season(tournament, season_start) values
  ('Russian Premier League', current_date - 120),
  ('Россия. Премьер-лига', current_date - 120);

insert into public.football_club(club_key, name, country)
select 'rpl-club-' || n, 'RPL Club ' || n, 'Россия'
from generate_series(1,16) n;
insert into public.football_club(club_key, name, country)
values ('tianjin jinmen tiger', 'Tianjin Jinmen Tiger', 'Китай');

-- Ten rounds, eight matches per round. Alternate source labels so every team
-- must be aggregated across both connected sources to reach ten appearances.
insert into public.club_match(tournament, match_date, home_key, away_key, home_score, away_score)
select case when round_no % 2 = 0 then 'Russian Premier League' else 'Россия. Премьер-лига' end,
       current_date - round_no * 3,
       'rpl-club-' || home_no,
       'rpl-club-' || (9 + mod((home_no - 1) + (round_no - 1), 8)),
       1, 0
from generate_series(1,10) round_no
cross join generate_series(1,8) home_no;

-- A foreign club has an otherwise valid score row under the English label;
-- the country guard must exclude it from Russian standings.
insert into public.club_match(tournament, match_date, home_key, away_key, home_score, away_score)
values ('Russian Premier League', current_date - 3, 'rpl-club-1', 'tianjin jinmen tiger', 1, 0);
