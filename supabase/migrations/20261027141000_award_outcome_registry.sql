-- Verified award outcomes are kept separate from candidate rankings.
-- A winner must be sourced and dated; never backfill the winner into an earlier snapshot.
create table if not exists public.award_outcome (
  award_key text not null check (award_key in (
    'ballon_dor', 'ballon_dor_feminin', 'the_best', 'the_best_female',
    'golden_boy', 'golden_boot'
  )),
  award_year smallint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  result text not null default 'winner' check (result in ('winner','nominee','runner_up')),
  announced_at timestamptz,
  source_url text not null check (source_url ~ '^https?://'),
  verified_at timestamptz not null default now(),
  verified_by text not null default 'official_or_primary_source',
  created_at timestamptz not null default now(),
  primary key (award_key, award_year, card_id, result)
);
alter table public.award_outcome enable row level security;
drop policy if exists award_outcome_read on public.award_outcome;
create policy award_outcome_read on public.award_outcome
  for select to anon, authenticated using (true);
grant select on public.award_outcome to anon, authenticated;
grant all on public.award_outcome to service_role;
comment on table public.award_outcome is
  'Verified real award results, separate from model candidate snapshots. Source URL and verification time are mandatory audit fields.';
