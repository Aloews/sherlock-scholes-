-- Daily contender rankings for team tournaments, with a separate verified outcome ledger.
create table if not exists public.team_tournament_candidate_snapshot (
  tournament text not null,
  season_start date not null,
  snapshot_date date not null,
  team_key text not null,
  team_name text not null,
  candidate_score numeric(5,2) not null check (candidate_score >= 0 and candidate_score <= 100),
  candidate_rank smallint not null check (candidate_rank >= 1 and candidate_rank <= 100),
  confidence text not null check (confidence in ('low','medium','high')),
  data_coverage numeric(5,4) not null check (data_coverage >= 0 and data_coverage <= 1),
  score_components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fetched_at timestamptz,
  model_version text not null,
  created_at timestamptz not null default now(),
  primary key (tournament, season_start, snapshot_date, team_key)
);
comment on table public.team_tournament_candidate_snapshot is
  'Daily evidence-based team tournament contender rankings. candidate_score is a relative index, not a calibrated probability; rows preserve what the model knew on snapshot_date.';
create index if not exists team_tournament_candidate_lookup_idx
  on public.team_tournament_candidate_snapshot (tournament, season_start, snapshot_date, candidate_rank);
alter table public.team_tournament_candidate_snapshot enable row level security;
revoke all on public.team_tournament_candidate_snapshot from anon, authenticated;

create table if not exists public.team_tournament_outcome (
  tournament text not null,
  season_start date not null,
  team_key text not null,
  team_name text not null,
  result text not null check (result in ('winner','runner_up','semifinalist','quarterfinalist')),
  announced_at timestamptz,
  source_url text not null check (source_url ~ '^https?://'),
  verified_at timestamptz not null default now(),
  verified_by text not null default 'official_or_primary_source',
  created_at timestamptz not null default now(),
  primary key (tournament, season_start, team_key)
);
comment on table public.team_tournament_outcome is
  'Verified team tournament outcomes, separate from candidate forecasts. Source URL and verification timestamp are mandatory audit fields.';
create unique index if not exists team_tournament_one_winner_idx
  on public.team_tournament_outcome (tournament, season_start)
  where result = 'winner';
alter table public.team_tournament_outcome enable row level security;
revoke all on public.team_tournament_outcome from anon, authenticated;
