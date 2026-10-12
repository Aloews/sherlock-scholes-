-- Defense in depth for presence: this table is intentionally accessed only
-- through initData-validating SECURITY DEFINER RPCs (touch_presence and
-- online_players). The original migration revoked direct table privileges,
-- but RLS was not enabled, leaving a schema-level security warning and no
-- row-policy boundary if privileges are ever reintroduced.
ALTER TABLE public.player_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_presence FROM PUBLIC, anon, authenticated;

-- This counter function is an internal implementation detail used by the
-- SECURITY DEFINER award_room_stats() function. Exposing it directly lets a
-- caller forge games, wins, cards guessed, score and XP for any player.
REVOKE ALL ON FUNCTION public.increment_player_stats(bigint, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_player_stats(bigint, integer, integer, integer, integer)
  TO service_role;

-- Verification queries:
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.player_presence'::regclass;
-- SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--  WHERE routine_schema = 'public' AND routine_name = 'increment_player_stats';
