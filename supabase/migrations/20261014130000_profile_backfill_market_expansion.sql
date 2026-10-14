-- Sherlock Scholes: idempotent player-profile backfill queue and multi-market odds storage.
-- This file is a proposal only. Apply through the normal reviewed migration workflow.
BEGIN;

CREATE TABLE IF NOT EXISTS public.profile_backfill_job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('photo', 'season_stats', 'match_stats', 'career_summary')),
  provider text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'retry', 'failed', 'no_source_data')),
  priority smallint NOT NULL DEFAULT 100,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS profile_backfill_job_claim_idx
  ON public.profile_backfill_job (priority ASC, next_attempt_at ASC, id ASC)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS profile_backfill_job_card_idx
  ON public.profile_backfill_job (card_id, task_type, status);

ALTER TABLE public.profile_backfill_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_backfill_job FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profile_backfill_job TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.profile_backfill_job_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.claim_profile_backfill_jobs(
  p_worker text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 600
)
RETURNS SETOF public.profile_backfill_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'limit must be between 1 and 100';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'lease must be between 30 and 3600 seconds';
  END IF;

  UPDATE public.profile_backfill_job
  SET status = 'failed', lease_owner = NULL, lease_until = NULL,
      completed_at = now(), updated_at = now(),
      last_error = COALESCE(last_error, 'retry limit exhausted after lease expiry')
  WHERE status = 'running' AND lease_until < now() AND attempts >= max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.profile_backfill_job AS j
    WHERE (
      (j.status IN ('pending', 'retry') AND j.next_attempt_at <= now())
      OR (j.status = 'running' AND j.lease_until < now())
    )
      AND j.attempts < j.max_attempts
    ORDER BY j.priority ASC, j.next_attempt_at ASC, j.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.profile_backfill_job AS j
  SET status = 'running',
      lease_owner = p_worker,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      attempts = j.attempts + 1,
      updated_at = now()
  FROM candidates AS c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_profile_backfill_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_profile_backfill_jobs(text, integer, integer) TO service_role;

-- A quote is one bookmaker's price for one selection on one market at one timestamp.
-- Keep all snapshots; never overwrite prices needed for backtesting.
CREATE TABLE IF NOT EXISTS public.market_odds_quote (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id text NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  sport_key text NOT NULL,
  provider text NOT NULL,
  bookmaker_key text NOT NULL,
  market_key text NOT NULL,
  selection_key text NOT NULL,
  line_value numeric(12,4),
  line_key numeric(12,4) GENERATED ALWAYS AS (COALESCE(line_value, -999999::numeric)) STORED,
  decimal_odds numeric(12,5) NOT NULL CHECK (decimal_odds > 1 AND decimal_odds <= 10000),
  snapshot_at timestamptz NOT NULL,
  commence_at timestamptz NOT NULL,
  source_event_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_odds_quote_dedupe_idx
  ON public.market_odds_quote (
    fixture_id, provider, bookmaker_key, market_key, selection_key,
    line_key, snapshot_at
  );
CREATE INDEX IF NOT EXISTS market_odds_quote_backtest_idx
  ON public.market_odds_quote (market_key, snapshot_at, fixture_id);
CREATE INDEX IF NOT EXISTS market_odds_quote_fixture_idx
  ON public.market_odds_quote (fixture_id, market_key, snapshot_at DESC);

ALTER TABLE public.market_odds_quote ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_odds_quote FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.market_odds_quote TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.market_odds_quote_id_seq TO service_role;

-- Versioned settlement rules make historical results reproducible when a rule changes.
CREATE TABLE IF NOT EXISTS public.market_settlement_rule (
  market_key text NOT NULL,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  rule_type text NOT NULL CHECK (rule_type IN (
    'three_way_result', 'two_way_result', 'totals', 'both_teams_to_score',
    'spread', 'draw_no_bet', 'double_chance', 'correct_score', 'player_prop'
  )),
  definition jsonb NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_key, rule_version)
);
INSERT INTO public.market_settlement_rule (market_key, rule_version, rule_type, definition, effective_from)
VALUES
  ('three_way_result', 1, 'three_way_result', '{"period":"regulation","selections":["home","draw","away"],"draw":"settle"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('two_way_result', 1, 'two_way_result', '{"period":"regulation","selections":["home","away"],"draw":"void"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('totals', 1, 'totals', '{"period":"regulation","selections":["over","under"],"line_required":true,"quarter_lines":"split_into_adjacent_half_lines"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('both_teams_to_score', 1, 'both_teams_to_score', '{"period":"regulation","selections":["yes","no"]}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('spread', 1, 'spread', '{"period":"regulation","selections":["home","away"],"line_required":true,"line_perspective":"selected_side","quarter_lines":"split_into_adjacent_half_lines"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('draw_no_bet', 1, 'draw_no_bet', '{"period":"regulation","selections":["home","away"],"draw":"push"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('double_chance', 1, 'double_chance', '{"period":"regulation","selections":["home_draw","draw_away","home_away"]}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz),
  ('correct_score', 1, 'correct_score', '{"period":"regulation","selection_format":"home-away"}'::jsonb, '2000-01-01T00:00:00Z'::timestamptz)
ON CONFLICT (market_key, rule_version) DO NOTHING;

ALTER TABLE public.market_settlement_rule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_settlement_rule FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.market_settlement_rule TO service_role;

CREATE TABLE IF NOT EXISTS public.market_selection_result (
  fixture_id text NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  market_key text NOT NULL,
  selection_key text NOT NULL,
  line_value numeric(12,4),
  line_key numeric(12,4) GENERATED ALWAYS AS (COALESCE(line_value, -999999::numeric)) STORED,
  rule_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'won', 'lost', 'push', 'void', 'half_won', 'half_lost')),
  actual_value numeric(12,4),
  source text NOT NULL,
  settled_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, market_key, selection_key, line_key, rule_version),
  FOREIGN KEY (market_key, rule_version)
    REFERENCES public.market_settlement_rule(market_key, rule_version)
);
ALTER TABLE public.market_selection_result ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_selection_result FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.market_selection_result TO service_role;

-- Separate budget windows per provider/endpoint/market family; reservation is atomic.
CREATE TABLE IF NOT EXISTS public.provider_api_budget (
  provider text NOT NULL,
  budget_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  hard_limit integer NOT NULL CHECK (hard_limit >= 0),
  used_units integer NOT NULL DEFAULT 0 CHECK (used_units >= 0),
  reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, budget_key, period_start),
  CHECK (used_units + reserved_units <= hard_limit)
);
ALTER TABLE public.provider_api_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_api_budget FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.provider_api_budget TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_provider_api_budget(
  p_provider text,
  p_budget_key text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_hard_limit integer,
  p_units integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserved integer;
BEGIN
  IF p_provider IS NULL OR p_budget_key IS NULL OR p_units < 1 OR p_hard_limit < 0
     OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid API budget reservation';
  END IF;

  INSERT INTO public.provider_api_budget
    (provider, budget_key, period_start, period_end, hard_limit, used_units, reserved_units)
  VALUES (p_provider, p_budget_key, p_period_start, p_period_end, p_hard_limit, 0, 0)
  ON CONFLICT (provider, budget_key, period_start) DO NOTHING;

  UPDATE public.provider_api_budget
  SET reserved_units = reserved_units + p_units,
      hard_limit = LEAST(hard_limit, p_hard_limit),
      period_end = LEAST(period_end, p_period_end),
      updated_at = now()
  WHERE provider = p_provider AND budget_key = p_budget_key
    AND period_start = p_period_start
    AND period_end = p_period_end
    AND used_units + reserved_units + p_units <= LEAST(hard_limit, p_hard_limit)
  RETURNING reserved_units INTO v_reserved;
  RETURN v_reserved IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_provider_api_budget(text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_provider_api_budget(text, text, timestamptz, timestamptz, integer, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.consume_provider_api_budget(
  p_provider text, p_budget_key text, p_period_start timestamptz, p_units integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $budget$
BEGIN
  IF p_units < 1 THEN RAISE EXCEPTION 'units must be positive'; END IF;
  UPDATE public.provider_api_budget
  SET reserved_units = reserved_units - p_units,
      used_units = used_units + p_units,
      updated_at = now()
  WHERE provider = p_provider AND budget_key = p_budget_key
    AND period_start = p_period_start AND reserved_units >= p_units;
  RETURN FOUND;
END;
$budget$;
REVOKE ALL ON FUNCTION public.consume_provider_api_budget(text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_provider_api_budget(text, text, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_provider_api_budget(
  p_provider text, p_budget_key text, p_period_start timestamptz, p_units integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $budget$
BEGIN
  IF p_units < 1 THEN RAISE EXCEPTION 'units must be positive'; END IF;
  UPDATE public.provider_api_budget
  SET reserved_units = reserved_units - p_units, updated_at = now()
  WHERE provider = p_provider AND budget_key = p_budget_key
    AND period_start = p_period_start AND reserved_units >= p_units;
  RETURN FOUND;
END;
$budget$;
REVOKE ALL ON FUNCTION public.release_provider_api_budget(text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_provider_api_budget(text, text, timestamptz, integer) TO service_role;

COMMIT;
