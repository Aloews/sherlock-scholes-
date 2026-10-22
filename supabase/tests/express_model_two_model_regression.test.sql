DO $$
DECLARE
  v_builder text := lower(pg_get_functiondef('public.build_model_accumulators(integer,integer[],numeric)'::regprocedure));
  v_runner text := lower(pg_get_functiondef('public.run_model_accumulator_generation()'::regprocedure));
  v_scoreboard text := lower(pg_get_functiondef('public.forecast_scoreboard(text)'::regprocedure));
  v_upcoming text := lower(pg_get_functiondef('public.forecast_upcoming_v2(integer,text)'::regprocedure));
BEGIN
  IF position('array[''llm'', ''own'']' in v_builder) = 0 THEN
    RAISE EXCEPTION 'accumulator builder must generate only llm and own models';
  END IF;
  IF position('array[''llm'', ''fly'', ''own'']' in v_builder) > 0 THEN
    RAISE EXCEPTION 'accumulator builder still includes connectome model';
  END IF;
  IF position(') = 2' in v_builder) = 0 THEN
    RAISE EXCEPTION 'accumulator builder must require two active model rows';
  END IF;
  IF position('p2.model in (''llm'', ''own'')' in v_builder) = 0 THEN
    RAISE EXCEPTION 'legacy fly rows must not affect active-model consensus';
  END IF;
  IF position(') = 3' in v_builder) > 0 THEN
    RAISE EXCEPTION 'accumulator builder still requires three model rows';
  END IF;
  IF position(') = 2' in v_runner) = 0 THEN
    RAISE EXCEPTION 'generation diagnostics must use two-model eligibility';
  END IF;
  IF position(') = 3' in v_runner) > 0 THEN
    RAISE EXCEPTION 'generation diagnostics still require three model rows';
  END IF;
  IF position('fp.model in (''llm'', ''own'')' in v_scoreboard) = 0 THEN
    RAISE EXCEPTION 'active forecast scoreboard must exclude connectome model';
  END IF;
  IF position('k.model in (''llm'', ''own'')' in v_upcoming) = 0 THEN
    RAISE EXCEPTION 'upcoming forecast RPC must use active models only';
  END IF;
  IF position('null::text, null::numeric, null::numeric' in v_upcoming) = 0 THEN
    RAISE EXCEPTION 'legacy connectome fields must be empty in upcoming forecasts';
  END IF;
END $$;
