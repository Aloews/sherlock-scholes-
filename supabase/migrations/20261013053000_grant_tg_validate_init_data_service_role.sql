-- The smart-deck-builder Edge Function validates signed Telegram initData
-- with the service-role Supabase client. SECURITY DEFINER does not bypass
-- PostgreSQL EXECUTE ACLs, and tg_validate_init_data was explicitly revoked
-- from PUBLIC without granting it to service_role. That caused every deck
-- generation attempt to fail with permission denied before catalog or AI work.
GRANT EXECUTE ON FUNCTION public.tg_validate_init_data(text) TO service_role;
