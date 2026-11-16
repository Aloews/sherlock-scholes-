-- Fix the OUT-parameter/column-name ambiguity in the voice pause RPCs.
-- The original definitions used unqualified paused_at in UPDATE predicates.
-- In RETURNS TABLE functions, paused_at is also a PL/pgSQL output variable.

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_ms INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.max_round_pause_ms()
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT 120000;
$$;

CREATE OR REPLACE FUNCTION public.pause_round(
  p_round_id UUID,
  p_init_data TEXT
)
RETURNS TABLE (paused_at TIMESTAMPTZ, paused_ms INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller BIGINT;
  v_round public.rounds%ROWTYPE;
BEGIN
  v_caller := public.tg_validate_init_data(p_init_data);
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT r.* INTO v_round
    FROM public.rounds AS r
   WHERE r.id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such round' USING ERRCODE = '22023';
  END IF;
  IF v_round.explainer_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the explainer may pause' USING ERRCODE = '42501';
  END IF;

  IF v_round.status <> 'active'
     OR v_round.paused_at IS NOT NULL
     OR v_round.paused_ms >= public.max_round_pause_ms() THEN
    RETURN QUERY SELECT v_round.paused_at, v_round.paused_ms;
    RETURN;
  END IF;

  UPDATE public.rounds AS r
     SET paused_at = now()
   WHERE r.id = p_round_id
     AND r.paused_at IS NULL
     AND r.status = 'active';

  RETURN QUERY
    SELECT r.paused_at, r.paused_ms
      FROM public.rounds AS r
     WHERE r.id = p_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_round(
  p_round_id UUID,
  p_init_data TEXT
)
RETURNS TABLE (paused_at TIMESTAMPTZ, paused_ms INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller BIGINT;
  v_round public.rounds%ROWTYPE;
  v_spent INTEGER;
BEGIN
  v_caller := public.tg_validate_init_data(p_init_data);
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT r.* INTO v_round
    FROM public.rounds AS r
   WHERE r.id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such round' USING ERRCODE = '22023';
  END IF;
  IF v_round.explainer_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the explainer may resume' USING ERRCODE = '42501';
  END IF;

  IF v_round.paused_at IS NULL THEN
    RETURN QUERY SELECT v_round.paused_at, v_round.paused_ms;
    RETURN;
  END IF;

  v_spent := LEAST(
    public.max_round_pause_ms(),
    v_round.paused_ms
      + (extract(epoch FROM (now() - v_round.paused_at)) * 1000)::INTEGER
  );

  UPDATE public.rounds AS r
     SET paused_ms = v_spent,
         paused_at = NULL
   WHERE r.id = p_round_id
     AND r.paused_at IS NOT NULL;

  RETURN QUERY
    SELECT r.paused_at, r.paused_ms
      FROM public.rounds AS r
     WHERE r.id = p_round_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pause_round(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resume_round(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_round(UUID, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_round(UUID, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.max_round_pause_ms()
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
