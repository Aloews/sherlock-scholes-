-- Repair accumulator builders after production RPCs failed with
-- SQLSTATE 21000: "DELETE requires a WHERE clause".
-- The database has a safe-delete guard. These DELETEs only clear private
-- temporary work tables, so TRUNCATE preserves the intended semantics without
-- weakening the guard or touching production data rows.
--
-- Preserve the currently deployed function bodies and change only the exact
-- temporary-table clear statements. Abort if the expected statements are not
-- present; do not silently mark a no-op migration successful.
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
    RAISE EXCEPTION 'Expected DELETE FROM _legs_tmp in build_model_accumulators was not found';
  END IF;
  EXECUTE v_after;

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
    RAISE EXCEPTION 'Expected DELETE FROM _bf_tmp in backfill_model_accumulators was not found';
  END IF;
  EXECUTE v_after;
END;
$fix$;
