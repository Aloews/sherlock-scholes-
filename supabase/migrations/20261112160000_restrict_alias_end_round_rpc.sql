-- Round completion must go through the authenticated Rust API.
-- The legacy SQL function remains available to the trusted server role only.
REVOKE ALL ON FUNCTION public.end_round(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_round(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
