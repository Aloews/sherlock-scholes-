DO $$
DECLARE
  v_builder text := pg_get_functiondef('public.build_model_accumulators(integer,integer[],numeric)'::regprocedure);
  v_runner text := pg_get_functiondef('public.run_model_accumulator_generation()'::regprocedure);
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
END $$;
