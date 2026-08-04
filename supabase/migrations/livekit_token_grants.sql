-- ============================================================
-- SHERLOCK SCHOLES — Migration: let livekit-token read the room
--
-- THE BUG THIS FIXES (found on production, 2026-08-03)
--
-- Voice never connected. The lobby said «Недоступен», and the reason took
-- three sessions to find because two layers were hiding it.
--
-- The Edge Function talks to PostgREST as `service_role` and does
--
--     SELECT team_id FROM room_players WHERE room_id = … AND player_id = …
--     SELECT mode, status FROM rooms WHERE id = …
--
-- but `service_role` had NO grant on either table — only anon and
-- authenticated did. PostgREST answered 403 "permission denied for table".
-- Side by side in the API log, the same query is 200 from the browser (anon)
-- and 403 from Deno/SupabaseEdgeRuntime (service_role).
--
-- WHY IT LOOKED LIKE SOMETHING ELSE. The function's select() helper returned
-- [] for both "no such row" and "the request failed", so a permission error
-- arrived at the player as `not_in_room` (403) — a confident verdict about
-- THEM for a fault on our side. That is fixed in the function itself: a
-- failed lookup is now 503 `lookup_failed`, which is what finally made this
-- visible. See docs/LOBBY_AND_VOICE_FIXES.md §3.
--
-- Note that this is a GRANT problem, not an RLS one. `service_role` normally
-- bypasses row-level policies, but bypassing RLS does not grant table
-- privileges — the two are separate, and rls_lockdown.sql's pattern of
-- granting anon/authenticated leaves service_role with nothing unless it is
-- named. Any new table an Edge Function must read needs the same line.
--
-- SELECT only, and only the three tables the function reads: it never writes
-- through this key, and the key never leaves the server.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ============================================================

GRANT SELECT ON public.room_players TO service_role;
GRANT SELECT ON public.rooms        TO service_role;
GRANT SELECT ON public.teams        TO service_role;

-- Verify:
--   SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name IN ('room_players','rooms','teams')
--      AND grantee = 'service_role';
