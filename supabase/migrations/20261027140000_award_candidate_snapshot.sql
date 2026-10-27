-- Candidate rankings are immutable daily snapshots. These are evidence scores,
-- not probabilities; the UI must not display them as win chances.
create table if not exists public.award_candidate_snapshot (
  award_key text not null check (award_key in (
    'ballon_dor', 'ballon_dor_feminin', 'the_best', 'the_best_female',
    'golden_boy', 'golden_boot'
  )),
  season_id smallint not null,
  snapshot_date date not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  candidate_score numeric(6,2) not null check (candidate_score >= 0 and candidate_score <= 100),
  candidate_rank smallint not null check (candidate_rank between 1 and 50),
  confidence text not null check (confidence in ('low','medium','high')),
  data_coverage numeric(4,3) not null check (data_coverage >= 0 and data_coverage <= 1),
  score_components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fetched_at timestamptz,
  model_version text not null,
  created_at timestamptz not null default now(),
  primary key (award_key, season_id, snapshot_date, card_id)
);

create index if not exists award_candidate_snapshot_latest_idx
  on public.award_candidate_snapshot (award_key, season_id, snapshot_date desc, candidate_rank);

alter table public.award_candidate_snapshot enable row level security;
drop policy if exists award_candidate_snapshot_read on public.award_candidate_snapshot;
create policy award_candidate_snapshot_read on public.award_candidate_snapshot
  for select to anon, authenticated using (true);
grant select on public.award_candidate_snapshot to anon, authenticated;
grant all on public.award_candidate_snapshot to service_role;

comment on table public.award_candidate_snapshot is
  'Daily evidence-based award candidate rankings. candidate_score is a relative index, never a calibrated probability; snapshots preserve what the system knew on each date.';
comment on column public.award_candidate_snapshot.score_components is
  'Percentile inputs actually used by the transparent scoring model.';
comment on column public.award_candidate_snapshot.evidence is
  'Source statistics and eligibility facts used at snapshot time.';
