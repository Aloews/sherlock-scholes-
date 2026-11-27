-- Disposable PostgreSQL regression for the private Football Dynasty schema.
-- This test is run only in the CI-owned PostgreSQL service.
DO $$
DECLARE
  v_tables integer;
  v_unprotected integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'fd_runtime' AND rolcanlogin = false
  ) THEN
    RAISE EXCEPTION 'fd_runtime must exist and must not be login-enabled';
  END IF;

  IF NOT has_schema_privilege('fd_runtime', 'fd', 'USAGE') THEN
    RAISE EXCEPTION 'fd_runtime must have USAGE on fd';
  END IF;
  IF has_schema_privilege('anon', 'fd', 'USAGE')
     OR has_schema_privilege('authenticated', 'fd', 'USAGE') THEN
    RAISE EXCEPTION 'public API roles must not have USAGE on fd';
  END IF;

  SELECT count(*) INTO v_tables
    FROM pg_tables WHERE schemaname = 'fd';
  IF v_tables < 12 THEN
    RAISE EXCEPTION 'expected at least 12 Football Dynasty tables, found %', v_tables;
  END IF;

  SELECT count(*) INTO v_unprotected
    FROM pg_tables t
   WHERE t.schemaname = 'fd'
     AND (NOT t.rowsecurity OR NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename
     ));
  IF v_unprotected <> 0 THEN
    RAISE EXCEPTION '% Football Dynasty tables have RLS disabled or no runtime policy', v_unprotected;
  END IF;

  IF NOT has_table_privilege('fd_runtime', 'fd.campaigns', 'SELECT')
     OR NOT has_table_privilege('fd_runtime', 'fd.campaigns', 'INSERT') THEN
    RAISE EXCEPTION 'fd_runtime is missing campaign read/write grants';
  END IF;

  IF has_table_privilege('anon', 'fd.campaigns', 'SELECT')
     OR has_table_privilege('authenticated', 'fd.campaigns', 'SELECT') THEN
    RAISE EXCEPTION 'public API roles must not read Football Dynasty campaigns';
  END IF;

  IF has_table_privilege('fd_runtime', 'fd.journal_entries', 'DELETE')
     OR has_table_privilege('fd_runtime', 'fd.journal_entries', 'UPDATE')
     OR has_table_privilege('fd_runtime', 'fd.journal_lines', 'DELETE')
     OR has_table_privilege('fd_runtime', 'fd.journal_lines', 'UPDATE')
     OR has_table_privilege('fd_runtime', 'fd.chronicle', 'DELETE')
     OR has_table_privilege('fd_runtime', 'fd.chronicle', 'UPDATE')
     OR has_table_privilege('fd_runtime', 'fd.succession_events', 'DELETE')
     OR has_table_privilege('fd_runtime', 'fd.succession_events', 'UPDATE') THEN
    RAISE EXCEPTION 'append-only financial/history tables must not be mutable by fd_runtime';
  END IF;
END
$$;
