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
  country text,
  continent text,
  top_league text,
  tags text[],
  langs text[],
  fame smallint
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


-- Minimal fixtures for the presence/stats privilege regression migration.
CREATE TABLE public.player_presence (
  player_id bigint PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false
);


CREATE TABLE public.rooms (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  stats_awarded_at timestamptz
);

ALTER TABLE public.rooms ADD COLUMN mode text NOT NULL DEFAULT 'team';
CREATE TABLE public.room_players (
  room_id uuid NOT NULL,
  player_id bigint NOT NULL,
  team_id uuid
);
CREATE TABLE public.scores (
  room_id uuid NOT NULL,
  team_id uuid NOT NULL,
  points integer NOT NULL
);
CREATE TABLE public.rounds (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  explainer_id bigint
);
CREATE TABLE public.round_cards (
  round_id uuid NOT NULL,
  status text NOT NULL
);
ALTER TABLE public.rounds ADD COLUMN team_id uuid;
ALTER TABLE public.rounds ADD COLUMN started_at timestamptz;
ALTER TABLE public.rounds ADD COLUMN ended_at timestamptz;
ALTER TABLE public.round_cards ADD COLUMN id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.round_cards ADD CONSTRAINT round_cards_test_id_key UNIQUE (id);
ALTER TABLE public.round_cards ADD COLUMN card_id uuid;
ALTER TABLE public.round_cards ADD COLUMN decided_at timestamptz;
ALTER TABLE public.cards ADD COLUMN category_ru text;
ALTER TABLE public.cards ADD COLUMN tier text;
CREATE FUNCTION public.tg_validate_init_data(text)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $tg$
  SELECT CASE WHEN length($1) > 0 THEN $1::bigint ELSE NULL END
$tg$;

CREATE FUNCTION public.increment_player_stats(bigint, integer, integer, integer, integer)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
