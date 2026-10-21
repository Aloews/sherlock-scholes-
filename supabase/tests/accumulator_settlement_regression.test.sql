\set ON_ERROR_STOP on

SELECT public.run_model_accumulator_generation();

DO $assert$
DECLARE
  v_run public.accumulator_generation_runs%ROWTYPE;
  v_rls boolean;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'build-model-accumulators') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one builder cron job';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'build-model-accumulators'
       AND command LIKE '%run_model_accumulator_generation%'
  ) THEN
    RAISE EXCEPTION 'builder cron is not using the instrumented wrapper';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'settle-model-accumulators') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one settlement cron job';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'settle-model-accumulators'
       AND schedule = '*/10 * * * *'
       AND command LIKE '%settle_accumulators%'
  ) THEN
    RAISE EXCEPTION 'settlement cron cadence/command is incorrect';
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.accumulator_ticket'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is disabled on accumulator_ticket'; END IF;
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.profile_backfill_jobs'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is disabled on profile_backfill_jobs'; END IF;
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public._bak_accumulator_ticket'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is disabled on backup table'; END IF;

  IF has_table_privilege('anon', 'public.accumulator_ticket', 'SELECT') THEN
    RAISE EXCEPTION 'anon can directly read accumulator_ticket';
  END IF;
  IF has_table_privilege('authenticated', 'public.accumulator_ticket', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can directly read accumulator_ticket';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.accumulator_generation_runs', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read generation diagnostics';
  END IF;

  SELECT * INTO v_run
    FROM public.accumulator_generation_runs
   ORDER BY id DESC LIMIT 1;
  IF v_run.status <> 'no_new_tickets' THEN
    RAISE EXCEPTION 'unexpected generation status: %', v_run.status;
  END IF;
  IF (v_run.metrics->>'future_forecast_rows')::integer <> 12 THEN
    RAISE EXCEPTION 'future forecast count missing/incorrect: %', v_run.metrics;
  END IF;
  IF (v_run.metrics->>'future_fixtures')::integer <> 4 THEN
    RAISE EXCEPTION 'future fixture count missing/incorrect: %', v_run.metrics;
  END IF;
  IF (v_run.metrics->>'unanimous_fixtures')::integer <> 4 THEN
    RAISE EXCEPTION 'unanimous fixture count missing/incorrect: %', v_run.metrics;
  END IF;
  IF (v_run.metrics->>'eligible_model_days_3_legs')::integer <> 3 THEN
    RAISE EXCEPTION '3-leg eligible model/day count missing/incorrect: %', v_run.metrics;
  END IF;
  IF (v_run.metrics->>'eligible_model_days_4_legs')::integer <> 3 THEN
    RAISE EXCEPTION '4-leg eligible model/day count missing/incorrect: %', v_run.metrics;
  END IF;
  IF (v_run.metrics->>'tickets_created')::integer <> 0 THEN
    RAISE EXCEPTION 'stub builder should not create tickets in this test: %', v_run.metrics;
  END IF;
END;
$assert$;

SELECT 'accumulator settlement/security regression: ok' AS result;
