-- The 2026-10-23 forecast-model retirement migration recreated both
-- accumulator functions and reintroduced unqualified DELETEs on private temp
-- tables. Restore the safe temp-table clear without weakening the DB guard.
-- This is idempotent and changes no persistent ticket or leg data.
DO $fix$
DECLARE
  v_before text;
  v_after text;
BEGIN
  SELECT pg_get_functiondef(
    'public.build_model_accumulators(integer,integer[],numeric)'::regprocedure
  ) INTO v_before;
  v_after := regexp_replace(
    v_before,
    'DELETE[[:space:]]+FROM[[:space:]]+_legs_tmp[[:space:]]*;',
    'TRUNCATE TABLE _legs_tmp;',
    'gi'
  );
  IF v_after = v_before THEN
    IF position('TRUNCATE TABLE _LEGS_TMP;' IN upper(v_before)) = 0 THEN
      RAISE EXCEPTION 'Expected temporary-table clear in build_model_accumulators was not found';
    END IF;
  ELSE
    EXECUTE v_after;
  END IF;

  SELECT pg_get_functiondef(
    'public.backfill_model_accumulators(numeric)'::regprocedure
  ) INTO v_before;
  v_after := regexp_replace(
    v_before,
    'DELETE[[:space:]]+FROM[[:space:]]+_bf_tmp[[:space:]]*;',
    'TRUNCATE TABLE _bf_tmp;',
    'gi'
  );
  IF v_after = v_before THEN
    IF position('TRUNCATE TABLE _BF_TMP;' IN upper(v_before)) = 0 THEN
      RAISE EXCEPTION 'Expected temporary-table clear in backfill_model_accumulators was not found';
    END IF;
  ELSE
    EXECUTE v_after;
  END IF;
END;
$fix$;
