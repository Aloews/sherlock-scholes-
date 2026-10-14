create extension if not exists pgcrypto;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Test player',
  name_en text,
  category text not null default 'player',
  active boolean default true,
  photo_url text,
  photo_source text,
  transfermarkt_id text,
  wikidata_qid text,
  market_value_eur bigint,
  career_stats jsonb,
  country text,
  position_ru text,
  born_on date
);

create table public.soccerwiki_player (
  card_id uuid primary key references public.cards(id) on delete cascade
);

create table public.player_season_stat (
  tm_player_id text not null,
  season_id smallint not null,
  competition_id text not null,
  club_id text not null,
  card_id uuid references public.cards(id),
  apps smallint,
  starts smallint,
  minutes integer,
  goals smallint,
  assists smallint,
  primary key (tm_player_id, season_id, competition_id, club_id)
);

create table public.fixtures (
  id text primary key
);
