-- Reproducible schema for the candidate ranking pipeline. Existing production tables
-- are preserved; IF NOT EXISTS makes this safe where the first version was applied manually.
create table if not exists public.award_candidate_snapshot (
  award_key text not null check (award_key in ('ballon_dor','ballon_dor_feminin','the_best','the_best_female','golden_boy','golden_boot')),
  season_id smallint not null,
  snapshot_date date not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  competition_id text not null default '*',
  candidate_score numeric not null check (candidate_score between 0 and 100),
  candidate_rank smallint not null check (candidate_rank between 1 and 50),
  confidence text not null check (confidence in ('low','medium','high')),
  data_coverage numeric not null check (data_coverage between 0 and 1),
  score_components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fetched_at timestamptz,
  model_version text not null,
  created_at timestamptz not null default now(),
  primary key (award_key, season_id, snapshot_date, card_id, competition_id)
);

-- Production initially had season-wide snapshots only. Extend the natural key so
-- Golden Boot can be ranked separately per tracked competition without collisions.
alter table public.award_candidate_snapshot add column if not exists competition_id text not null default '*';
alter table public.award_candidate_snapshot drop constraint if exists award_candidate_snapshot_pkey;
alter table public.award_candidate_snapshot
  add constraint award_candidate_snapshot_pkey
  primary key (award_key, season_id, snapshot_date, card_id, competition_id);

create table if not exists public.award_candidate_evaluation (
  award_key text not null,
  award_year smallint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  result text not null check (result in ('winner','nominee','runner_up')),
  announced_at timestamptz,
  source_url text,
  last_pre_award_snapshot date,
  winner_rank_before_award smallint,
  winner_score_before_award numeric,
  winner_data_coverage numeric,
  predicted_top_1 boolean,
  predicted_top_5 boolean,
  primary key (award_key, award_year, card_id, result)
);

create table if not exists public.award_outcome (
  award_key text not null check (award_key in ('ballon_dor','ballon_dor_feminin','the_best','the_best_female','golden_boy','golden_boot')),
  award_year smallint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  result text not null check (result in ('winner','nominee','runner_up')),
  announced_at timestamptz,
  source_url text not null check (source_url ~ '^https?://'),
  verified_at timestamptz not null default now(),
  verified_by text not null,
  created_at timestamptz not null default now(),
  primary key (award_key, award_year, card_id, result)
);

create table if not exists public.team_tournament_candidate_snapshot (
  tournament text not null,
  season_start date not null,
  snapshot_date date not null,
  team_key text not null,
  team_name text not null,
  candidate_score numeric not null check (candidate_score between 0 and 100),
  candidate_rank smallint not null check (candidate_rank between 1 and 100),
  confidence text not null check (confidence in ('low','medium','high')),
  data_coverage numeric not null check (data_coverage between 0 and 1),
  score_components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fetched_at timestamptz,
  model_version text not null,
  created_at timestamptz not null default now(),
  primary key (tournament, season_start, snapshot_date, team_key)
);

create table if not exists public.team_tournament_outcome (
  tournament text not null,
  season_start date not null,
  team_key text not null,
  team_name text not null,
  result text not null check (result in ('winner','runner_up','semifinalist','quarterfinalist')),
  announced_at timestamptz,
  source_url text not null check (source_url ~ '^https?://'),
  verified_at timestamptz not null default now(),
  verified_by text not null,
  created_at timestamptz not null default now(),
  primary key (tournament, season_start, team_key),
  unique (tournament, season_start, result, team_key)
);

create index if not exists award_candidate_latest_idx
  on public.award_candidate_snapshot (award_key, season_id, snapshot_date desc, candidate_rank);
create index if not exists team_tournament_candidate_latest_idx
  on public.team_tournament_candidate_snapshot (tournament, snapshot_date desc, candidate_rank);
create index if not exists award_outcome_year_idx on public.award_outcome (award_year, award_key, result);
create index if not exists team_tournament_outcome_season_idx
  on public.team_tournament_outcome (tournament, season_start, result);

alter table public.award_candidate_snapshot enable row level security;
alter table public.award_candidate_evaluation enable row level security;
alter table public.award_outcome enable row level security;
alter table public.team_tournament_candidate_snapshot enable row level security;
alter table public.team_tournament_outcome enable row level security;

drop function if exists public.admin_list_award_candidates(text, text);
create or replace function public.admin_list_award_candidates(
  p_password text,
  p_award_key text default null,
  p_competition_id text default null
)
returns table (
  award_key text,
  season_id smallint,
  snapshot_date date,
  card_id uuid,
  competition_id text,
  card_name text,
  photo_url text,
  category text,
  position_ru text,
  candidate_score numeric,
  candidate_rank smallint,
  confidence text,
  data_coverage numeric,
  score_components jsonb,
  evidence jsonb,
  model_version text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  return query
  select s.award_key, s.season_id, s.snapshot_date, s.card_id, s.competition_id, c.name, c.photo_url,
         c.category, c.position_ru, s.candidate_score, s.candidate_rank, s.confidence,
         s.data_coverage, s.score_components, s.evidence, s.model_version
    from public.award_candidate_snapshot s
    join public.cards c on c.id = s.card_id
   where s.snapshot_date = (
     select max(latest.snapshot_date)
       from public.award_candidate_snapshot latest
      where latest.award_key = s.award_key and latest.season_id = s.season_id
   )
     and (p_award_key is null or s.award_key = p_award_key)
     and (p_competition_id is null or s.competition_id = p_competition_id)
   order by s.award_key, s.competition_id, s.candidate_rank
   limit 1000;
end;
$$;

revoke all on function public.admin_list_award_candidates(text, text, text) from public;
grant execute on function public.admin_list_award_candidates(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
