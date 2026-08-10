-- ============================================================================
-- SHERLOCK SCHOLES — predict the score, and be scored on it
--
-- WHY THIS IS A PLAYER'S PREDICTION AND NOT A BOOKMAKER'S. §4 of
-- docs/LIVE_FOOTBALL_HANDOFF.md put bookmaker prices permanently off screen,
-- including anything derived from them — "favourite" is the odd restated. So a
-- "prediction" feature can only mean one thing here: the player says what they
-- think the score will be, and afterwards finds out. That is also the better
-- product, and it is the foundation the fantasy work needs — points and
-- friend leagues are the same two ideas.
--
-- THE SCORING LADDER. Exact score 5, right goal difference 3, right winner 2,
-- otherwise 0. Written as an IMMUTABLE function rather than inline so the rule
-- can be tested on its own and quoted to a player without reading an UPDATE.
-- Note 1:1 against a real 2:2 scores 3 — the difference is right — which is
-- deliberate and worth knowing before somebody reports it as a bug.
--
-- CLOSING TIME IS THE KICK-OFF, AND POSTGRES DECIDES IT. `predict_match`
-- compares against `now()` on the server; a phone with a wrong clock, or a
-- player who would like one, cannot predict a match that has started.
--
-- SETTLEMENT NEEDS SCORES, AND SCORES COST MONEY. /events is free and has been
-- filling `fixtures` all along, but /scores costs a credit per call against a
-- hard ceiling of 500 a month (fixtures_and_odds.sql). So the fetch must be
-- DEMAND-DRIVEN: `sports_awaiting_scores` returns only competitions where a
-- real prediction is waiting on a real finished match. No predictions, no
-- spend — the budget follows the players rather than the calendar.
--
-- SECURITY. Writes derive the player from signed initData; a client cannot
-- predict on somebody else's behalf, and cannot rewrite a prediction that has
-- already been settled (the ON CONFLICT has a WHERE). Settlement and the score
-- fetch are service_role only: a player who could call settle_predictions
-- could not change the outcome, but a player who could call
-- upsert_fixture_scores could.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================================

create table if not exists public.match_predictions (
  fixture_id  text   not null references public.fixtures(id) on delete cascade,
  player_id   bigint not null references public.players(id)  on delete cascade,
  home_score  smallint not null check (home_score >= 0 and home_score <= 99),
  away_score  smallint not null check (away_score >= 0 and away_score <= 99),
  created_at  timestamptz not null default now(),
  -- NULL until the match is over and settlement has run. Not 0: "nobody has
  -- checked yet" and "you got nothing" are different answers.
  points      integer,
  settled_at  timestamptz,
  primary key (fixture_id, player_id)
);

create index if not exists match_predictions_player_idx
  on public.match_predictions (player_id, created_at desc);
-- Partial: settlement only ever asks about the unsettled ones, and the index
-- stays small no matter how many seasons accumulate.
create index if not exists match_predictions_unsettled_idx
  on public.match_predictions (fixture_id) where settled_at is null;

comment on table public.match_predictions is
  'One score prediction per player per match. points is NULL until the match '
  'is finished and settle_predictions() has run — see match_predictions.sql.';

alter table public.match_predictions enable row level security;
revoke all on public.match_predictions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rule, on its own so it can be tested and quoted.
-- ---------------------------------------------------------------------------
create or replace function public.prediction_points(
  p_pred_home smallint, p_pred_away smallint,
  p_real_home smallint, p_real_away smallint
) returns integer
language sql immutable as $$
  select case
    when p_pred_home = p_real_home and p_pred_away = p_real_away then 5
    when (p_pred_home - p_pred_away) = (p_real_home - p_real_away) then 3
    when sign(p_pred_home - p_pred_away) = sign(p_real_home - p_real_away) then 2
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- predict_match — before kick-off, and only for yourself.
-- ---------------------------------------------------------------------------
create or replace function public.predict_match(
  p_init_data text,
  p_fixture_id text,
  p_home smallint,
  p_away smallint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_start timestamptz;
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  if p_home is null or p_away is null
     or p_home < 0 or p_away < 0 or p_home > 99 or p_away > 99 then
    return false;
  end if;

  select commence_at into v_start from fixtures where id = p_fixture_id;
  if v_start is null then
    return false;
  end if;
  -- The server's clock, not the caller's. This is the whole integrity of the
  -- feature: a prediction made after kick-off is not a prediction.
  if v_start <= now() then
    return false;
  end if;

  insert into match_predictions (fixture_id, player_id, home_score, away_score)
       values (p_fixture_id, v_me, p_home, p_away)
  on conflict (fixture_id, player_id) do update
    set home_score = excluded.home_score,
        away_score = excluded.away_score,
        created_at = now()
    -- Changing your mind is fine; changing it after the points are awarded is
    -- not. Belt and braces with the kick-off check above.
    where match_predictions.settled_at is null;

  return true;
end;
$$;

create or replace function public.my_predictions(p_init_data text)
returns table (
  fixture_id  text,
  home_score  smallint,
  away_score  smallint,
  points      integer,
  settled_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  return query
    select p.fixture_id, p.home_score, p.away_score, p.points, p.settled_at
      from match_predictions p
     where p.player_id = v_me
     order by p.created_at desc
     limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_predictions — award the points for every finished match.
--
-- Idempotent by construction: `settled_at is null` is both the filter and what
-- the UPDATE sets, so a second run finds nothing. Returns how many rows it
-- settled, so a scheduler can log something meaningful.
-- ---------------------------------------------------------------------------
create or replace function public.settle_predictions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update match_predictions p
     set points = prediction_points(p.home_score, p.away_score, f.home_score, f.away_score),
         settled_at = now()
    from fixtures f
   where f.id = p.fixture_id
     and p.settled_at is null
     and f.completed
     and f.home_score is not null
     and f.away_score is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- sports_awaiting_scores — where the money should be spent, if anywhere.
--
-- Only competitions with a prediction waiting on a match that has plausibly
-- finished. 105 minutes is a match plus half-time plus stoppage; earlier than
-- that and the provider has nothing final to say, so the credit is wasted.
-- The seven-day floor stops a match the provider never finalises from
-- charging us a credit a day forever.
-- ---------------------------------------------------------------------------
create or replace function public.sports_awaiting_scores()
returns table (sport_key text)
language sql stable
security definer
set search_path = public
as $$
  select distinct f.sport_key
    from match_predictions p
    join fixtures f on f.id = p.fixture_id
   where p.settled_at is null
     and f.commence_at < now() - interval '105 minutes'
     and f.commence_at > now() - interval '7 days'
     and not f.completed;
$$;

-- ---------------------------------------------------------------------------
-- upsert_fixture_scores — write what /scores returned.
--
-- Only ever touches the score columns, and only when both numbers are present:
-- a match still in progress reports nulls, and writing those over a score we
-- already had would un-finish a finished match.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_fixture_scores(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update fixtures f
     set home_score = (r->>'home_score')::smallint,
         away_score = (r->>'away_score')::smallint,
         completed  = coalesce((r->>'completed')::boolean, false),
         scores_at  = now(),
         updated_at = now()
    from jsonb_array_elements(p_rows) as r
   where f.id = r->>'id'
     and (r->>'home_score') is not null
     and (r->>'away_score') is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Players may predict and read their own; nobody but the service role
-- may settle or write a score. A player who could call settle_predictions
-- could not change an outcome — but one who could call upsert_fixture_scores
-- could award themselves five points, so that line is the important one.
-- ---------------------------------------------------------------------------
revoke all on function public.predict_match(text, text, smallint, smallint) from public;
revoke all on function public.my_predictions(text) from public;
revoke all on function public.settle_predictions() from public;
revoke all on function public.sports_awaiting_scores() from public;
revoke all on function public.upsert_fixture_scores(jsonb) from public;
revoke all on function public.prediction_points(smallint, smallint, smallint, smallint) from public;

grant execute on function public.predict_match(text, text, smallint, smallint) to anon, authenticated, service_role;
grant execute on function public.my_predictions(text) to anon, authenticated, service_role;
grant execute on function public.prediction_points(smallint, smallint, smallint, smallint) to anon, authenticated, service_role;
grant execute on function public.settle_predictions() to service_role;
grant execute on function public.sports_awaiting_scores() to service_role;
grant execute on function public.upsert_fixture_scores(jsonb) to service_role;
