DO $test$
DECLARE
  v_definition text;
  v_result text;
BEGIN
  SELECT pg_get_functiondef(
    'public.build_model_accumulators(integer,integer[],numeric)'::regprocedure
  ) INTO v_definition;
  IF position('TRUNCATE TABLE _legs_tmp;' IN v_definition) = 0
     OR position('DELETE FROM _legs_tmp;' IN upper(v_definition)) > 0 THEN
    RAISE EXCEPTION 'build_model_accumulators was not safely rewritten';
  END IF;

  SELECT pg_get_functiondef(
    'public.backfill_model_accumulators(numeric)'::regprocedure
  ) INTO v_definition;
  IF position('TRUNCATE TABLE _bf_tmp;' IN v_definition) = 0
     OR position('DELETE FROM _BF_TMP;' IN upper(v_definition)) > 0 THEN
    RAISE EXCEPTION 'backfill_model_accumulators was not safely rewritten';
  END IF;

  v_result := public.build_model_accumulators();
  IF v_result <> 'build-ok' THEN
    RAISE EXCEPTION 'unexpected build result: %', v_result;
  END IF;
  v_result := public.backfill_model_accumulators();
  IF v_result <> 'backfill-ok' THEN
    RAISE EXCEPTION 'unexpected backfill result: %', v_result;
  END IF;
END;
$test$;
