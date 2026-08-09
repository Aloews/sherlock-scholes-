-- ============================================================================
-- Matches from the-odds-api: schedule, score, and the odds nobody sees.
--
-- Decisions this implements are §4 of docs/LIVE_FOOTBALL_HANDOFF.md, taken on
-- 4 August 2026. Two of them shape every line below:
--
--   1. ODDS ARE INTERNAL. They never reach a screen, and no phrasing derived
--      from them does either — "favourite" is the odd restated. They earn their
--      place by ranking which matches are worth showing at all. Hence: their
--      own table, and NO RLS POLICY AT ALL, which in Postgres means nothing
--      reaches them through PostgREST no matter what a client asks. That is
--      the safety catch, and removing it is removing the decision.
--
--   2. 500 CREDITS A MONTH IS A HARD CEILING. /events costs nothing, /scores
--      costs one, /odds costs one per market per region. Run out and the
--      provider REFUSES rather than returning less, so without a counter on
--      our side the ceiling is discovered at the end of the month in the shape
--      of an empty screen. The guard below is that counter, and it is checked
--      before the call, not after.
--
-- The primary key here is the PROVIDER'S. That is not a contradiction of the
-- rule that cards live on our own uuid: a card is our entity, a match is
-- theirs, and inventing a key for someone else's row buys nothing. The link
-- between them is optional and resolved by name, because the provider has no
-- idea what our cards are.
-- ============================================================================

create table if not exists public.fixtures (
  id            text primary key,          -- the provider's event id
  sport_key     text not null,             -- soccer_epl, soccer_spain_la_liga …
  commence_at   timestamptz not null,
  home_team     text not null,             -- as the provider spells it, English
  away_team     text not null,
  -- Nullable on purpose. A match whose clubs we could not identify still gets
  -- shown, with the provider's own names: disappearing would be worse, and
  -- silently guessing worse still.
  home_card_id  uuid references public.cards(id) on delete set null,
  away_card_id  uuid references public.cards(id) on delete set null,
  home_score    smallint,
  away_score    smallint,
  completed     boolean not null default false,
  -- When the score was last refreshed. The screen MUST show this: a score
  -- fifteen minutes stale, presented as current, is the same lie we refused
  -- when we dropped wiki as a source of scores.
  scores_at     timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists fixtures_commence_at_idx on public.fixtures (commence_at);
create index if not exists fixtures_sport_idx       on public.fixtures (sport_key, commence_at);

comment on column public.fixtures.scores_at is
  'When the score was last fetched. The UI must render the age of this, not '
  'the score alone — a stale score shown as current is a lie about liveness.';

create table if not exists public.fixture_odds (
  fixture_id  text not null references public.fixtures(id) on delete cascade,
  taken_at    timestamptz not null,
  bookmaker   text not null,
  home_price  numeric(6,2),
  draw_price  numeric(6,2),
  away_price  numeric(6,2),
  primary key (fixture_id, taken_at, bookmaker)
);

comment on table public.fixture_odds is
  'Bookmaker prices, INTERNAL ONLY. Never rendered, and nothing derived from '
  'them is rendered either. Deliberately has no RLS policy: see the header of '
  'this migration and §4.4 of docs/LIVE_FOOTBALL_HANDOFF.md.';

-- The budget guard. One row per UTC month; `credits` is what we have spent.
create table if not exists public.odds_api_budget (
  month       date primary key,            -- first of the month, UTC
  credits     integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
--
-- fixtures: public to read, written only by SECURITY DEFINER below.
-- fixture_odds and odds_api_budget: enabled with NO POLICY, which is a
-- deliberate lockdown rather than an oversight — RLS with no policy denies
-- everything to anon and authenticated, and the service role bypasses it.
-- The same shape friends/player_encounters use.
-- ---------------------------------------------------------------------------
alter table public.fixtures       enable row level security;
alter table public.fixture_odds   enable row level security;
alter table public.odds_api_budget enable row level security;

drop policy if exists fixtures_read on public.fixtures;
create policy fixtures_read on public.fixtures for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- The monthly ceiling.
--
-- Checked BEFORE a call, and it reserves rather than records: a request that
-- was made and then not counted is how a budget quietly overruns. The caller
-- gets false and makes no request at all.
-- ---------------------------------------------------------------------------
create or replace function public.odds_api_monthly_limit() returns integer
language sql immutable as $$ select 500 $$;

/**
 * Reserve `p_credits` against this month's allowance.
 *
 * Returns true when the spend fits and has been recorded, false when it would
 * breach the ceiling — in which case the caller must not make the request.
 * Atomic: the insert-on-conflict takes the row lock, so two schedulers firing
 * at the same minute cannot both squeeze through the last credit.
 */
create or replace function public.spend_odds_credits(p_credits integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_after integer;
begin
  if p_credits is null or p_credits < 0 then
    raise exception 'credits must be zero or more' using errcode = '22023';
  end if;
  -- Free endpoints (/events, /sports) cost nothing and must never be blocked
  -- by a budget they do not consume.
  if p_credits = 0 then
    return true;
  end if;

  insert into odds_api_budget (month, credits)
       values (v_month, 0)
  on conflict (month) do update set month = excluded.month
    returning credits into v_after;

  if v_after + p_credits > odds_api_monthly_limit() then
    return false;
  end if;

  update odds_api_budget
     set credits = credits + p_credits, updated_at = now()
   where month = v_month;

  return true;
end;
$$;

/** What is left this month. For the check script and the admin screen. */
create or replace function public.odds_credits_left()
returns integer
language sql
security definer
set search_path = public
as $$
  select odds_api_monthly_limit() - coalesce(
    (select credits from odds_api_budget
      where month = date_trunc('month', now() at time zone 'utc')::date), 0);
$$;

revoke all on function public.spend_odds_credits(integer) from public, anon, authenticated;
grant execute on function public.spend_odds_credits(integer) to service_role;
revoke all on function public.odds_credits_left() from public;
grant execute on function public.odds_credits_left() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- upsert_fixtures — the schedule, written wholesale from /events.
--
-- Takes the whole batch as jsonb so one call replaces a page of them, and
-- leaves the score columns ALONE: /events knows nothing about scores, and a
-- schedule refresh that blanked the score would undo the expensive half of the
-- data with the free half.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_fixtures(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into fixtures as f (
    id, sport_key, commence_at, home_team, away_team,
    home_card_id, away_card_id, updated_at
  )
  select
    r->>'id',
    r->>'sport_key',
    (r->>'commence_at')::timestamptz,
    r->>'home_team',
    r->>'away_team',
    nullif(r->>'home_card_id', '')::uuid,
    nullif(r->>'away_card_id', '')::uuid,
    now()
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update set
    sport_key    = excluded.sport_key,
    commence_at  = excluded.commence_at,
    home_team    = excluded.home_team,
    away_team    = excluded.away_team,
    -- Keep a club we identified earlier if this batch could not identify one:
    -- matching improves as cards are added, and it must never go backwards.
    home_card_id = coalesce(excluded.home_card_id, f.home_card_id),
    away_card_id = coalesce(excluded.away_card_id, f.away_card_id),
    updated_at   = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_fixtures(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_fixtures(jsonb) to service_role;
