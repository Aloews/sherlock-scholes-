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


-- Attribute existing values to the collector that already wrote them; this is
-- provenance backfill only and does not change any stored amount or source date.
update public.cards
   set market_value_source = 'Transfermarkt TMAPI market-value-history',
       market_value_source_url = 'https://www.transfermarkt.com/spieler/profil/spieler/' || transfermarkt_id,
       market_value_observed_at = coalesce(market_value_checked_at, now())
 where market_value_eur is not null
   and transfermarkt_id is not null
   and market_value_source is null;


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

-- Optional source fields are accepted by the existing RPC payload, so old clients
-- remain compatible while new collector runs record where the stored price came from.
create or replace function public.apply_card_market_values(p_rows jsonb)
returns table(written integer, seen integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_written integer;
  v_seen integer;
begin
  with raw as (
    select
      (r->>'card_id')::uuid as card_id,
      nullif(r->>'value_eur', '')::bigint as value_eur,
      nullif(r->>'valued_at', '')::date as valued_at,
      nullif(r->>'source', '') as source,
      nullif(r->>'source_url', '') as source_url,
      coalesce(nullif(r->>'observed_at', '')::timestamptz, now()) as observed_at
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where (r->>'card_id') is not null
  ),
  src as materialized (
    select r.*,
      c.market_value_eur as old_value,
      c.market_value_at as old_at,
      (
        r.value_eur > 0 and r.valued_at is not null
        and r.valued_at <= current_date
        and (c.market_value_at is null or r.valued_at >= c.market_value_at)
      ) as price_accepted,
      (
        r.value_eur > 0 and r.valued_at is not null
        and r.valued_at <= current_date
        and (c.market_value_at is null or r.valued_at >= c.market_value_at)
        and (c.market_value_eur is distinct from r.value_eur
          or c.market_value_at is distinct from r.valued_at)
      ) as price_changed
    from raw r
    join public.cards c on c.id = r.card_id
  ),
  upd as (
    update public.cards c
       set market_value_eur = case when s.price_accepted then s.value_eur else c.market_value_eur end,
           market_value_at = case when s.price_accepted then s.valued_at else c.market_value_at end,
           market_value_source = case when s.price_accepted then coalesce(s.source, 'Transfermarkt TMAPI market-value-history') else c.market_value_source end,
           market_value_source_url = case when s.price_accepted then coalesce(s.source_url, 'https://www.transfermarkt.com/spieler/profil/spieler/' || c.transfermarkt_id) else c.market_value_source_url end,
           market_value_observed_at = case when s.price_accepted then s.observed_at else c.market_value_observed_at end,
           market_value_checked_at = now()
      from src s
     where c.id = s.card_id
    returning c.id
  )
  select count(*) filter (where s.price_changed)::integer,
         count(*)::integer
    into v_written, v_seen
    from src s
    cross join (select count(*) from upd) completed;

  return query select coalesce(v_written, 0), coalesce(v_seen, 0);
end;
$function$;

revoke all on function public.apply_card_market_values(jsonb) from public;
grant execute on function public.apply_card_market_values(jsonb) to service_role;

-- The calibrated values live inside score_components so the existing admin
-- RPCs expose them without a second, competing candidate-read implementation.
create or replace function public.apply_forecast_calibration(p_rows jsonb)
returns table(updated integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated integer := 0;
  v_count integer := 0;
begin
  with raw as (
    select
      r->>'kind' as kind,
      nullif(r->>'snapshot_date', '')::date as snapshot_date,
      nullif(r->>'probability', '')::numeric as probability,
      coalesce(nullif(r->>'calibration_status', ''), 'insufficient_training') as calibration_status,
      greatest(0, coalesce(nullif(r->>'training_examples', '')::integer, 0)) as training_examples,
      coalesce(nullif(r->>'model_version', ''), 'walk-forward-platt-v1') as model_version,
      nullif(r->>'award_key', '') as award_key,
      nullif(r->>'season_id', '')::smallint as season_id,
      coalesce(nullif(r->>'competition_id', ''), '*') as competition_id,
      nullif(r->>'card_id', '')::uuid as card_id,
      nullif(r->>'tournament', '') as tournament,
      nullif(r->>'season_start', '')::date as season_start,
      nullif(r->>'team_key', '') as team_key
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ),
  award_updates as (
    update public.award_candidate_snapshot a
       set score_components =
         (a.score_components - 'calibrated_win_probability' - 'calibration_sample_size'
                             - 'calibration_status' - 'calibration_model_version')
         || jsonb_build_object(
              'calibration_status', r.calibration_status,
              'calibration_model_version', r.model_version,
              'calibration_sample_size', r.training_examples
            )
         || case when r.probability between 0 and 1
                 then jsonb_build_object('calibrated_win_probability', r.probability)
                 else '{}'::jsonb end
      from raw r
     where r.kind = 'award'
       and r.card_id is not null
       and a.award_key = r.award_key
       and a.season_id = r.season_id
       and a.competition_id = r.competition_id
       and a.snapshot_date = r.snapshot_date
       and a.card_id = r.card_id
    returning a.card_id
  ),
  team_updates as (
    update public.team_tournament_candidate_snapshot t
       set score_components =
         (t.score_components - 'calibrated_win_probability' - 'calibration_sample_size'
                             - 'calibration_status' - 'calibration_model_version')
         || jsonb_build_object(
              'calibration_status', r.calibration_status,
              'calibration_model_version', r.model_version,
              'calibration_sample_size', r.training_examples
            )
         || case when r.probability between 0 and 1
                 then jsonb_build_object('calibrated_win_probability', r.probability)
                 else '{}'::jsonb end
      from raw r
     where r.kind = 'team_tournament'
       and r.team_key is not null
       and t.tournament = r.tournament
       and t.season_start = r.season_start
       and t.snapshot_date = r.snapshot_date
       and t.team_key = r.team_key
    returning t.team_key
  )
  select (select count(*) from award_updates) + (select count(*) from team_updates)
    into v_count;
  v_updated := coalesce(v_count, 0);
  return query select v_updated;
end;
$function$;

revoke all on function public.apply_forecast_calibration(jsonb) from public, anon, authenticated;
grant execute on function public.apply_forecast_calibration(jsonb) to service_role;

-- Same-metric disagreement between the official profile page and its API proxy
-- is retained for review instead of silently choosing or averaging one value.
create table if not exists public.market_value_reconciliation_issue (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  transfermarkt_id text not null,
  api_value_eur bigint not null check (api_value_eur > 0),
  api_valued_at date not null,
  profile_value_eur bigint not null check (profile_value_eur > 0),
  profile_valued_at date not null,
  observed_at timestamptz not null default now(),
  source_url text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (card_id, api_value_eur, api_valued_at, profile_value_eur, profile_valued_at)
);

create index if not exists market_value_reconciliation_open_idx
  on public.market_value_reconciliation_issue (observed_at desc)
  where status = 'open';

alter table public.market_value_reconciliation_issue enable row level security;
revoke all on public.market_value_reconciliation_issue from anon, authenticated;
grant all on public.market_value_reconciliation_issue to service_role;

create or replace function public.record_market_value_reconciliation_issues(p_rows jsonb)
returns table(recorded integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  with raw as (
    select (r->>'card_id')::uuid as card_id,
           r->>'transfermarkt_id' as transfermarkt_id,
           (r->>'api_value_eur')::bigint as api_value_eur,
           (r->>'api_valued_at')::date as api_valued_at,
           (r->>'profile_value_eur')::bigint as profile_value_eur,
           (r->>'profile_valued_at')::date as profile_valued_at,
           coalesce(nullif(r->>'observed_at','')::timestamptz, now()) as observed_at,
           r->>'source_url' as source_url
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where nullif(r->>'card_id','') is not null
       and nullif(r->>'transfermarkt_id','') is not null
       and nullif(r->>'api_value_eur','') is not null
       and nullif(r->>'api_valued_at','') is not null
       and nullif(r->>'profile_value_eur','') is not null
       and nullif(r->>'profile_valued_at','') is not null
  ),
  saved as (
    insert into public.market_value_reconciliation_issue
      (card_id, transfermarkt_id, api_value_eur, api_valued_at,
       profile_value_eur, profile_valued_at, observed_at, source_url)
    select card_id, transfermarkt_id, api_value_eur, api_valued_at,
           profile_value_eur, profile_valued_at, observed_at, source_url
      from raw
    on conflict (card_id, api_value_eur, api_valued_at, profile_value_eur, profile_valued_at)
    do update set observed_at = excluded.observed_at
    returning id
  )
  select count(*)::integer into v_count from saved;
  return query select coalesce(v_count, 0);
end;
$function$;

revoke all on function public.record_market_value_reconciliation_issues(jsonb) from public, anon, authenticated;
grant execute on function public.record_market_value_reconciliation_issues(jsonb) to service_role;

