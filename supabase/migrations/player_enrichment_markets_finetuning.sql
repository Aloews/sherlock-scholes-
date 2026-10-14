-- Player enrichment queue, normalized multi-market odds, settlement rules and
-- reproducible model-training run registry. This migration is not applied by CI.
-- Internal tables deliberately have RLS enabled and no client-facing policies.

create table if not exists public.player_enrichment_queue (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  task_type text not null check (task_type in ('photo','season_stats')),
  source text not null check (source in ('transfermarkt','wikidata')),
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','no_data','retryable','failed')),
  priority integer not null default 0,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  finished_at timestamptz,
  result_count integer not null default 0 check (result_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, task_type, source),
  check (task_type <> 'season_stats' or source = 'transfermarkt')
);

create index if not exists player_enrichment_queue_claim_idx
  on public.player_enrichment_queue (status, next_attempt_at, priority desc, id);
create index if not exists player_enrichment_queue_card_idx
  on public.player_enrichment_queue (card_id, task_type, status);

alter table public.player_enrichment_queue enable row level security;

create or replace function public.enqueue_player_enrichment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.player_enrichment_queue
    (card_id, task_type, source, priority)
  select c.id, 'photo', 'transfermarkt',
         100 + least(coalesce(c.market_value_eur, 0) / 1000000, 50)::integer
    from public.cards c
   where c.category = 'player'
     and c.active is distinct from false
     and nullif(btrim(c.photo_url), '') is null
     and nullif(btrim(c.transfermarkt_id), '') is not null
  union all
  select c.id, 'photo', 'wikidata', 70
    from public.cards c
   where c.category = 'player'
     and c.active is distinct from false
     and nullif(btrim(c.photo_url), '') is null
     and nullif(btrim(c.wikidata_qid), '') is not null
  union all
  select c.id, 'season_stats', 'transfermarkt',
         80 + least(coalesce(c.market_value_eur, 0) / 1000000, 50)::integer
    from public.cards c
   where c.category = 'player'
     and c.active is distinct from false
     and nullif(btrim(c.transfermarkt_id), '') is not null
     and not exists (
       select 1 from public.player_season_stat s
        where s.card_id = c.id
           or s.tm_player_id = c.transfermarkt_id
     )
  on conflict (card_id, task_type, source) do nothing;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('inserted', v_inserted);
end;
$$;

create or replace function public.claim_player_enrichment_jobs(
  p_limit integer default 50,
  p_worker text default 'github-actions'
)
returns setof public.player_enrichment_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select q.id
      from public.player_enrichment_queue q
     where q.status in ('pending', 'retryable')
       and q.next_attempt_at <= now()
       and q.attempts < q.max_attempts
     order by q.priority desc, q.created_at, q.id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 50), 1), 250)
  )
  update public.player_enrichment_queue q
     set status = 'processing',
         attempts = q.attempts + 1,
         claimed_by = left(coalesce(nullif(p_worker, ''), 'worker'), 100),
         claimed_at = now(),
         updated_at = now(),
         last_error = null
    from candidates c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.enqueue_player_enrichment() from public, anon, authenticated;
revoke all on function public.claim_player_enrichment_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.enqueue_player_enrichment() to service_role;
grant execute on function public.claim_player_enrichment_jobs(integer, text) to service_role;

-- All odds markets share fixture identity but never share a price column.
-- line_key distinguishes main-line quotes from exact totals/handicaps.
create table if not exists public.market_odds (
  fixture_id text not null references public.fixtures(id) on delete cascade,
  observed_at timestamptz not null,
  provider_key text not null default 'the-odds-api',
  region text not null,
  bookmaker text not null,
  market_key text not null,
  selection_key text not null,
  line_key text not null default 'main',
  line_value numeric(7,3),
  price numeric(8,3) not null check (price > 1),
  raw_outcome jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (fixture_id, observed_at, provider_key, region, bookmaker,
               market_key, selection_key, line_key)
);

create index if not exists market_odds_latest_idx
  on public.market_odds (fixture_id, market_key, observed_at desc);
create index if not exists market_odds_selection_idx
  on public.market_odds (market_key, selection_key, observed_at desc);

comment on table public.market_odds is
  'Internal bookmaker snapshots. No client policy; normalized per market, selection and line.';

alter table public.market_odds enable row level security;

create table if not exists public.market_settlement_rules (
  market_key text primary key,
  settlement_method text not null check (settlement_method in
    ('result_1x2','goals_total','asian_handicap','both_teams_score',
     'draw_no_bet','double_chance')),
  requires_line boolean not null default false,
  allows_push boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.market_settlement_rules
  (market_key, settlement_method, requires_line, allows_push)
values
  ('h2h', 'result_1x2', false, false),
  ('totals', 'goals_total', true, true),
  ('spreads', 'asian_handicap', true, true),
  ('btts', 'both_teams_score', false, false),
  ('draw_no_bet', 'draw_no_bet', false, true),
  ('double_chance', 'double_chance', false, false)
on conflict (market_key) do update
  set settlement_method = excluded.settlement_method,
      requires_line = excluded.requires_line,
      allows_push = excluded.allows_push,
      active = true,
      updated_at = now();

alter table public.market_settlement_rules enable row level security;

create or replace function public.upsert_market_odds(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.market_odds (
    fixture_id, observed_at, provider_key, region, bookmaker,
    market_key, selection_key, line_key, line_value, price, raw_outcome
  )
  select r->>'fixture_id',
         coalesce(nullif(r->>'observed_at', '')::timestamptz, now()),
         coalesce(nullif(r->>'provider_key', ''), 'the-odds-api'),
         coalesce(nullif(r->>'region', ''), 'eu'),
         r->>'bookmaker',
         r->>'market_key',
         lower(r->>'selection_key'),
         coalesce(nullif(r->>'line_key', ''), 'main'),
         nullif(r->>'line_value', '')::numeric,
         nullif(r->>'price', '')::numeric,
         coalesce(r->'raw_outcome', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where nullif(r->>'fixture_id', '') is not null
     and nullif(r->>'bookmaker', '') is not null
     and nullif(r->>'market_key', '') is not null
     and nullif(r->>'selection_key', '') is not null
     and coalesce(nullif(r->>'price', '')::numeric, 0) > 1
     and exists (select 1 from public.fixtures f where f.id = r->>'fixture_id')
     and exists (
       select 1 from public.market_settlement_rules s
        where s.market_key = r->>'market_key' and s.active
     )
  on conflict (fixture_id, observed_at, provider_key, region, bookmaker,
               market_key, selection_key, line_key)
  do update set line_value = excluded.line_value,
                price = excluded.price,
                raw_outcome = excluded.raw_outcome;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_market_odds(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_market_odds(jsonb) to service_role;

create or replace function public.settle_market_pick(
  p_market_key text,
  p_selection_key text,
  p_line numeric,
  p_home_score integer,
  p_away_score integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_diff numeric;
  v_line_twice numeric;
begin
  if p_home_score is null or p_away_score is null then
    return 'pending';
  end if;

  if p_market_key = 'h2h' then
    if p_selection_key = 'home' then
      return case when p_home_score > p_away_score then 'win' else 'loss' end;
    elsif p_selection_key = 'draw' then
      return case when p_home_score = p_away_score then 'win' else 'loss' end;
    elsif p_selection_key = 'away' then
      return case when p_away_score > p_home_score then 'win' else 'loss' end;
    end if;
  elsif p_market_key = 'totals' then
    if p_line is null or p_selection_key not in ('over', 'under') then
      return 'unsupported';
    end if;
    v_line_twice := p_line * 2;
    if v_line_twice <> trunc(v_line_twice) then
      return 'unsupported_line';
    end if;
    v_total := p_home_score + p_away_score;
    if v_total = p_line then return 'push'; end if;
    if p_selection_key = 'over' then
      return case when v_total > p_line then 'win' else 'loss' end;
    end if;
    return case when v_total < p_line then 'win' else 'loss' end;
  elsif p_market_key = 'spreads' then
    if p_line is null or p_selection_key not in ('home', 'away') then
      return 'unsupported';
    end if;
    v_line_twice := p_line * 2;
    if v_line_twice <> trunc(v_line_twice) then
      return 'unsupported_line';
    end if;
    if p_selection_key = 'home' then
      v_diff := p_home_score + p_line - p_away_score;
    else
      v_diff := p_away_score + p_line - p_home_score;
    end if;
    if v_diff = 0 then return 'push'; end if;
    return case when v_diff > 0 then 'win' else 'loss' end;
  elsif p_market_key = 'btts' then
    if p_selection_key = 'yes' then
      return case when p_home_score > 0 and p_away_score > 0 then 'win' else 'loss' end;
    elsif p_selection_key = 'no' then
      return case when p_home_score = 0 or p_away_score = 0 then 'win' else 'loss' end;
    end if;
  elsif p_market_key = 'draw_no_bet' then
    if p_home_score = p_away_score then return 'push'; end if;
    if p_selection_key = 'home' then
      return case when p_home_score > p_away_score then 'win' else 'loss' end;
    elsif p_selection_key = 'away' then
      return case when p_away_score > p_home_score then 'win' else 'loss' end;
    end if;
  elsif p_market_key = 'double_chance' then
    if p_selection_key = 'home_draw' then
      return case when p_home_score >= p_away_score then 'win' else 'loss' end;
    elsif p_selection_key = 'draw_away' then
      return case when p_home_score <= p_away_score then 'win' else 'loss' end;
    elsif p_selection_key = 'home_away' then
      return case when p_home_score <> p_away_score then 'win' else 'loss' end;
    end if;
  end if;
  return 'unsupported';
end;
$$;

create table if not exists public.market_collection_state (
  collector_key text primary key,
  next_slot integer not null default 0 check (next_slot >= 0),
  updated_at timestamptz not null default now()
);
alter table public.market_collection_state enable row level security;

create or replace function public.claim_market_collection_slots(
  p_slots jsonb,
  p_limit integer default 4
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_cursor integer;
  v_take integer;
  v_out jsonb := '[]'::jsonb;
  i integer;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'p_slots must be a JSON array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_slots);
  if v_count = 0 then return v_out; end if;

  insert into public.market_collection_state (collector_key, next_slot)
  values ('football-market-expansion', 0)
  on conflict (collector_key) do nothing;

  select next_slot into v_cursor
    from public.market_collection_state
   where collector_key = 'football-market-expansion'
   for update;

  v_take := least(greatest(coalesce(p_limit, 4), 0), v_count);
  for i in 0..v_take - 1 loop
    v_out := v_out || jsonb_build_array(p_slots -> ((v_cursor + i) % v_count));
  end loop;

  update public.market_collection_state
     set next_slot = (v_cursor + v_take) % v_count,
         updated_at = now()
   where collector_key = 'football-market-expansion';
  return v_out;
end;
$$;

revoke all on function public.claim_market_collection_slots(jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_market_collection_slots(jsonb, integer) to service_role;

create table if not exists public.model_training_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task in ('football_analysis','match_outcome')),
  provider text not null,
  base_model text not null,
  method text not null check (method in ('provider_finetune','lora','qlora','linear_baseline')),
  status text not null default 'queued'
    check (status in ('queued','running','evaluating','succeeded','rejected','failed')),
  dataset_sha256 text,
  dataset_version text,
  train_examples integer not null default 0,
  validation_examples integer not null default 0,
  test_examples integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  artifact_uri text,
  provider_job_id text,
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now()
);
create index if not exists model_training_runs_recent_idx
  on public.model_training_runs (created_at desc, status);
alter table public.model_training_runs enable row level security;
