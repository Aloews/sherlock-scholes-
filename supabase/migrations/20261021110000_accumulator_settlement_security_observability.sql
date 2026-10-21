-- Repair model accumulator lifecycle and lock down internal tables.
-- Existing tickets are intentionally unique by model/rule + match_day; this
-- migration does not fabricate duplicate tickets or rewrite historical picks.
-- It adds run-level diagnostics and ensures completed matches are settled.

CREATE TABLE IF NOT EXISTS public.accumulator_generation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'created', 'no_new_tickets', 'skipped', 'failed')),
  result_text text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text
);

ALTER TABLE public.accumulator_generation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accumulator_generation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.accumulator_generation_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.accumulator_generation_runs_id_seq TO service_role;

COMMENT ON TABLE public.accumulator_generation_runs IS
  'Internal diagnostics for scheduled model accumulator generation; no public client access.';

CREATE OR REPLACE FUNCTION public.run_model_accumulator_generation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run_id bigint;
  v_started timestamptz := clock_timestamp();
  v_before bigint;
  v_after bigint;
  v_result text;
  v_error text;
  v_metrics jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public.run_model_accumulator_generation', 0)) THEN
    INSERT INTO public.accumulator_generation_runs
      (started_at, finished_at, status, result_text, metrics)
    VALUES
      (v_started, clock_timestamp(), 'skipped', 'generation already running',
       jsonb_build_object('reason', 'advisory_lock_held'));
    RETURN 'generation skipped: another run holds the lock';
  END IF;

  SELECT count(*) INTO v_before FROM public.accumulator_ticket;

  SELECT jsonb_build_object(
    'checked_at', clock_timestamp(),
    'window_days', 14,
    'floor', 0.47,
    'future_forecast_rows', (
      SELECT count(*) FROM public.forecast_pick p
       WHERE p.commence_at > now()
         AND p.commence_at < now() + interval '14 days'
    ),
    'future_fixtures', (
      SELECT count(DISTINCT p.fixture_id) FROM public.forecast_pick p
       WHERE p.commence_at > now()
         AND p.commence_at < now() + interval '14 days'
    ),
    'unanimous_fixtures', (
      SELECT count(*) FROM (
        SELECT p.fixture_id
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
         GROUP BY p.fixture_id
        HAVING count(*) = 3 AND count(DISTINCT p.pick) = 1
      ) q
    ),
    'eligible_model_days_3_legs', (
      SELECT count(*) FROM (
        SELECT (p.commence_at AT TIME ZONE 'UTC')::date AS match_day, p.model
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
           AND (SELECT count(*) FROM public.forecast_pick p2 WHERE p2.fixture_id = p.fixture_id) = 3
           AND (SELECT count(DISTINCT p2.pick) FROM public.forecast_pick p2 WHERE p2.fixture_id = p.fixture_id) = 1
           AND public.calibrated_confidence(p.confidence, p.model) >= 0.47
         GROUP BY (p.commence_at AT TIME ZONE 'UTC')::date, p.model
        HAVING count(*) >= 3
      ) q
    ),
    'eligible_model_days_4_legs', (
      SELECT count(*) FROM (
        SELECT (p.commence_at AT TIME ZONE 'UTC')::date AS match_day, p.model
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
           AND (SELECT count(*) FROM public.forecast_pick p2 WHERE p2.fixture_id = p.fixture_id) = 3
           AND (SELECT count(DISTINCT p2.pick) FROM public.forecast_pick p2 WHERE p2.fixture_id = p.fixture_id) = 1
           AND public.calibrated_confidence(p.confidence, p.model) >= 0.47
         GROUP BY (p.commence_at AT TIME ZONE 'UTC')::date, p.model
        HAVING count(*) >= 4
      ) q
    ),
    'existing_future_model_tickets', (
      SELECT count(*) FROM public.accumulator_ticket t
       WHERE t.model IS NOT NULL AND t.settled_at IS NULL
         AND t.match_day >= (now() AT TIME ZONE 'UTC')::date
    )
  ) INTO v_metrics;

  INSERT INTO public.accumulator_generation_runs (started_at, status, metrics)
  VALUES (v_started, 'running', v_metrics)
  RETURNING id INTO v_run_id;

  BEGIN
    v_result := public.build_model_accumulators();
    SELECT count(*) INTO v_after FROM public.accumulator_ticket;

    UPDATE public.accumulator_generation_runs
       SET finished_at = clock_timestamp(),
           status = CASE WHEN v_after > v_before THEN 'created' ELSE 'no_new_tickets' END,
           result_text = v_result,
           metrics = metrics || jsonb_build_object(
             'tickets_before', v_before,
             'tickets_after', v_after,
             'tickets_created', greatest(v_after - v_before, 0)
           )
     WHERE id = v_run_id;

    RETURN format('%s; run_id=%s; tickets_before=%s; tickets_after=%s; tickets_created=%s',
                  coalesce(v_result, 'builder returned NULL'), v_run_id, v_before, v_after,
                  greatest(v_after - v_before, 0));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    UPDATE public.accumulator_generation_runs
       SET finished_at = clock_timestamp(),
           status = 'failed',
           error_text = v_error,
           metrics = metrics || jsonb_build_object('tickets_before', v_before)
     WHERE id = v_run_id;
    RETURN format('generation failed; run_id=%s; error=%s', v_run_id, v_error);
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_model_accumulator_generation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_model_accumulator_generation() TO service_role;

-- RLS is defense in depth. These tables are internal and currently have no
-- anon/authenticated table grants; keep that boundary explicit as well.
DO $security$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND (
         c.relname = ANY (ARRAY[
           'accumulator_ticket', 'accumulator_leg', 'llm_budget',
           'llm_auto_switch', 'espn_league_slug', 'fan_club', 'fan_club_member',
           'profile_backfill_jobs'
         ])
         OR left(c.relname, 5) = '_bak_'
       )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
  END LOOP;
END;
$security$;

-- Replace the old silent cron invocation with an instrumented wrapper.
DO $schedule$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN SELECT jobid FROM cron.job WHERE jobname = 'build-model-accumulators'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;

  FOR v_jobid IN SELECT jobid FROM cron.job WHERE jobname = 'settle-model-accumulators'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;

  PERFORM cron.schedule(
    'build-model-accumulators',
    '10 7 * * *',
    'SELECT public.run_model_accumulator_generation()'
  );

  -- Settle every ten minutes: the daily builder is not a settlement mechanism.
  PERFORM cron.schedule(
    'settle-model-accumulators',
    '*/10 * * * *',
    'SELECT public.settle_accumulators()'
  );
END;
$schedule$;
