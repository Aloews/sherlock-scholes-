-- Disposable PostgreSQL stubs matching the deployed function signatures.
-- The migration should rewrite only the temporary-table clearing statements.
CREATE OR REPLACE FUNCTION public.build_model_accumulators(
  p_days integer DEFAULT 14,
  p_legs integer[] DEFAULT ARRAY[3,4],
  p_floor numeric DEFAULT 0.47
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _legs_tmp (
    fixture_id text, pick text, prob numeric,
    home_team text, away_team text, commence_at timestamptz
  ) ON COMMIT DROP;
  DELETE FROM _legs_tmp;
  RETURN 'build-ok';
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_model_accumulators(
  p_floor numeric DEFAULT 0.47
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _bf_tmp (
    fixture_id text, pick text, prob numeric, correct boolean,
    home_team text, away_team text, commence_at timestamptz
  ) ON COMMIT DROP;
  DELETE FROM _bf_tmp;
  RETURN 'backfill-ok';
END;
$function$;
