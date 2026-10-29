\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.cards (
  id uuid primary key,
  transfermarkt_id text,
  market_value_eur bigint,
  market_value_at date,
  market_value_checked_at timestamptz,
  market_value_source text,
  market_value_source_url text,
  market_value_observed_at timestamptz
);

create table public.award_candidate_snapshot (
  award_key text not null,
  season_id smallint not null,
  snapshot_date date not null,
  card_id uuid not null references public.cards(id),
  competition_id text not null default '*',
  score_components jsonb not null default '{}'::jsonb,
  primary key (award_key, season_id, snapshot_date, card_id, competition_id)
);

create table public.team_tournament_candidate_snapshot (
  tournament text not null,
  season_start date not null,
  snapshot_date date not null,
  team_key text not null,
  score_components jsonb not null default '{}'::jsonb,
  primary key (tournament, season_start, snapshot_date, team_key)
);
