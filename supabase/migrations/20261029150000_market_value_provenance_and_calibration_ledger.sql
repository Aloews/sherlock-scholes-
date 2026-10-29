-- Preserve source provenance for canonical Transfermarkt market values and
-- add an auditable walk-forward calibration ledger. This migration is additive.
alter table public.cards
  add column if not exists market_value_source text,
  add column if not exists market_value_source_url text,
  add column if not exists market_value_observed_at timestamptz;

comment on column public.cards.market_value_source is
  'Source/interface used for the stored market_value_eur; distinct from estimated transfer value (ETV).';
comment on column public.cards.market_value_source_url is
  'Canonical source profile URL for the stored market value.';
comment on column public.cards.market_value_observed_at is
  'Time the source observation was retrieved, distinct from the source valuation date market_value_at.';

create table if not exists public.forecast_calibration_evaluation (
  id bigint generated always as identity primary key,
  forecast_kind text not null check (forecast_kind in ('award','team_tournament')),
  forecast_key text not null,
  evaluation_snapshot_date date not null,
  outcome_announced_at timestamptz not null,
  training_cutoff timestamptz not null,
  training_examples integer not null check (training_examples >= 0),
  training_winners integer not null check (training_winners >= 0),
  training_seasons integer not null check (training_seasons >= 0),
  evaluation_candidates integer not null check (evaluation_candidates >= 0),
  brier_score numeric,
  log_loss numeric,
  expected_calibration_error numeric,
  top_1_accuracy numeric,
  status text not null check (status in ('evaluated','insufficient_training','missing_temporal_evidence')),
  model_version text not null,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (forecast_kind, forecast_key, evaluation_snapshot_date, outcome_announced_at, model_version)
);

create index if not exists forecast_calibration_evaluation_recent_idx
  on public.forecast_calibration_evaluation (forecast_kind, forecast_key, created_at desc);

alter table public.forecast_calibration_evaluation enable row level security;
revoke all on public.forecast_calibration_evaluation from anon, authenticated;
grant all on public.forecast_calibration_evaluation to service_role;
