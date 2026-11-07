-- Rotate profile-backfill claims across source types so high source-priority
-- offsets cannot starve season_stats behind photo_qid/photo_tm work.
CREATE TABLE IF NOT EXISTS public.profile_backfill_claim_cursor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_task_type text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.profile_backfill_claim_cursor(singleton,last_task_type)
VALUES (true,NULL)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.profile_backfill_claim_cursor FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_profile_backfill_jobs(
  p_limit integer DEFAULT 20,
  p_lease_minutes integer DEFAULT 45
)
RETURNS SETOF public.profile_backfill_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last_task_type text;
  v_job public.profile_backfill_jobs%rowtype;
  v_task_order text[] := ARRAY['photo_qid','photo_tm','photo_sw','season_stats'];
  v_i integer;
  v_last_position integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_lease_minutes IS NULL OR p_lease_minutes < 5 OR p_lease_minutes > 240 THEN
    RAISE EXCEPTION 'invalid claim limits' USING errcode = '22023';
  END IF;

  INSERT INTO public.profile_backfill_claim_cursor(singleton,last_task_type)
  VALUES (true,NULL)
  ON CONFLICT (singleton) DO NOTHING;

  FOR v_i IN 1..p_limit LOOP
    SELECT last_task_type
      INTO v_last_task_type
      FROM public.profile_backfill_claim_cursor
     WHERE singleton=true
     FOR UPDATE;

    v_last_position := array_position(v_task_order,v_last_task_type);

    SELECT j.*
      INTO v_job
      FROM public.profile_backfill_jobs j
     WHERE (
       (j.status='pending' AND j.attempts < j.max_attempts
        AND (j.attempts=0 OR j.updated_at < now()-interval '60 minutes'))
       OR
       (j.status='running' AND j.updated_at < now()-make_interval(mins=>p_lease_minutes))
     )
     ORDER BY
       CASE
         WHEN v_last_position IS NULL THEN array_position(v_task_order,j.task_type)
         ELSE mod(
           array_position(v_task_order,j.task_type) - v_last_position - 1
           + array_length(v_task_order,1),
           array_length(v_task_order,1)
         )
       END,
       j.priority DESC,
       j.created_at,
       j.id
     FOR UPDATE OF j SKIP LOCKED
     LIMIT 1;

    IF NOT FOUND THEN
      EXIT;
    END IF;

    UPDATE public.profile_backfill_jobs j
       SET status='running',
           attempts=least(j.attempts+1,j.max_attempts),
           updated_at=now(),
           last_error=null
     WHERE j.id=v_job.id
     RETURNING j.* INTO v_job;

    UPDATE public.profile_backfill_claim_cursor
       SET last_task_type=v_job.task_type,
           updated_at=now()
     WHERE singleton=true;

    RETURN NEXT v_job;
  END LOOP;

  RETURN;
END;
$function$;
