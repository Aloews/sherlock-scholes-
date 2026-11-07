DO $$
DECLARE v_options text[];
BEGIN
  SELECT reloptions INTO v_options FROM pg_class WHERE oid='public.award_candidate_evaluation'::regclass;
  IF NOT coalesce(v_options, '{}'::text[]) @> ARRAY['security_invoker=true'] THEN
    RAISE EXCEPTION 'award_candidate_evaluation must use security_invoker=true';
  END IF;
  IF has_table_privilege('anon','public.award_candidate_evaluation','SELECT')
     OR has_table_privilege('authenticated','public.award_candidate_evaluation','SELECT') THEN
    RAISE EXCEPTION 'client roles must not read the internal award evaluation view';
  END IF;
  IF NOT has_table_privilege('service_role','public.award_candidate_evaluation','SELECT') THEN
    RAISE EXCEPTION 'service_role must retain access to the award evaluation view';
  END IF;
END
$$;
