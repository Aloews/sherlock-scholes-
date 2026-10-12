-- Minimal disposable PostgreSQL schema for the two rating-cache migrations.
-- This is a test harness only; it contains no production data and is never
-- linked to the production Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_en text,
  category text not null,
  active boolean not null default true,
  photo_url text,
  country text
);

create table public.player_match_stats (
  card_id uuid not null references public.cards(id),
  match_date date not null,
  tournament text not null,
  minutes integer,
  goals integer not null default 0,
  assists integer not null default 0,
  source text not null,
  disputed boolean not null default false
);

create view public.player_match_days as
select distinct on (card_id, match_date)
       card_id, match_date, tournament, minutes, goals, assists, source
  from public.player_match_stats
 where not disputed
 order by card_id, match_date, (minutes is not null) desc,
          source, tournament, goals desc, assists desc;

create table public.player_rating_cache (
  days smallint not null,
  card_id uuid not null references public.cards(id),
  matches integer not null,
  minutes integer not null,
  goals integer not null,
  assists integer not null,
  primary key (days, card_id)
);

create table public.card_current_club (card_id uuid, club_key text);
create table public.football_club (club_key text primary key, name text, league text);
create table public.club_squad (card_id uuid, club_key text, left_at date);
create table public.player_level (card_id uuid, level smallint, basis text);

-- The verifier calls unrelated production routines. Stubs let this harness
-- compile and inspect verify_card_data() without running any external work.
create function public.add_clubs_from_soccerwiki()
returns table(created integer) language sql as $$ select 0 $$;
create function public.link_soccerwiki_by_name()
returns table(linked integer) language sql as $$ select 0 $$;
create function public.fill_current_club_from_roster()
returns table(written integer) language sql as $$ select 0 $$;
create function public.fill_current_club_from_soccerwiki()
returns table("записано" integer) language sql as $$ select 0 $$;
create function public.card_club_conflicts()
returns table(card_id uuid) language sql as $$ select null::uuid where false $$;
