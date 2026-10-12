DO $$
DECLARE
  v_rls boolean;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'smart_deck_editorial_cache';

  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'smart_deck_editorial_cache must have RLS enabled';
  END IF;

  IF has_table_privilege('anon', 'public.smart_deck_editorial_cache', 'SELECT')
     OR has_table_privilege('anon', 'public.smart_deck_editorial_cache', 'INSERT')
     OR has_table_privilege('authenticated', 'public.smart_deck_editorial_cache', 'SELECT')
     OR has_table_privilege('authenticated', 'public.smart_deck_editorial_cache', 'INSERT') THEN
    RAISE EXCEPTION 'client roles must not access the AI editorial cache';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.smart_deck_editorial_cache', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.smart_deck_editorial_cache', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.smart_deck_editorial_cache', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role must be able to use the AI editorial cache';
  END IF;
END $$;

SELECT 'smart_deck_editorial_cache: all assertions passed' AS result;
