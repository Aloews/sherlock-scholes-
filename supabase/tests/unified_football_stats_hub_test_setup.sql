-- Minimal schema for the shared football statistics read-layer regression.
create table if not exists public.player_season_stat (
  tm_player_id text not null,
  season_id smallint not null,
  competition_id text not null,
  club_id text not null,
  card_id uuid,
  apps smallint not null default 0,
  starts smallint not null default 0,
  sub_in smallint not null default 0,
  sub_out smallint not null default 0,
  minutes integer not null default 0,
  goals smallint not null default 0,
  assists smallint not null default 0,
  own_goals smallint not null default 0,
  penalty_goals smallint not null default 0,
  yellow smallint not null default 0,
  yellow_red smallint not null default 0,
  red smallint not null default 0,
  team_goals smallint not null default 0,
  opponent_goals smallint not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (tm_player_id, season_id, competition_id, club_id)
);
create table if not exists public.tm_club (
  id text primary key, name text, country_id integer,
  is_national_team boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.tm_competition (
  id text primary key, name text, short_name text, country_id integer,
  type_id integer, logo_url text, updated_at timestamptz not null default now()
);
