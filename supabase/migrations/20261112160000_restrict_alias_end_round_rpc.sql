-- These SECURITY DEFINER routines are internal database operations.
-- Clients must use the authenticated Rust API; pg_cron runs as the postgres owner.
DO $
BEGIN
  IF to_regprocedure('public.end_round(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.end_round(uuid) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.sweep_stale_rooms(integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sweep_stale_rooms(integer) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$;

NOTIFY pgrst, 'reload schema';
