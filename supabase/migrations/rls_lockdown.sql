-- ============================================================
-- SHERLOCK SCHOLES — Migration: RLS lockdown
-- Closes the Supabase "RLS disabled / allow-all" critical warning.
--
-- PREREQUISITE (do this FIRST, before running this SQL):
--   football_scraper currently uses the ANON key. Replace SUPABASE_KEY
--   in football_scraper/.env with the service_role key
--   (Dashboard -> Settings -> API -> service_role, marked "secret").
--   service_role BYPASSES RLS, so the scraper keeps working after
--   this migration. The frontend keeps the anon key — that is correct.
--
-- Model: the game has no Supabase Auth (players are Telegram IDs the
-- DB never verifies), so policies here are PER-OPERATION, not per-user.
-- The goal is least privilege for the anon key:
--   * deck (cards) becomes read-only for the public
--   * scraper tables (players_meta, player_seasons) become fully
--     private (service_role only)
--   * multiplayer tables allow exactly the operations the frontend
--     performs — nothing more (e.g. nobody can DELETE rooms/rounds/
--     scores or UPDATE cards via the anon key anymore)
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

-- ============================================================
-- 1. ENABLE RLS ON EVERY PUBLIC TABLE
--    (no-op where already enabled; the linter says some are off)
-- ============================================================
ALTER TABLE players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_cards     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE players_meta    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_seasons  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. DROP THE OLD ALLOW-ALL POLICIES
--    ("FOR ALL USING (true)" is equivalent to RLS being off)
-- ============================================================
DROP POLICY IF EXISTS "allow_all_players"        ON players;
DROP POLICY IF EXISTS "allow_all_rooms"          ON rooms;
DROP POLICY IF EXISTS "allow_all_teams"          ON teams;
DROP POLICY IF EXISTS "allow_all_room_players"   ON room_players;
DROP POLICY IF EXISTS "allow_all_cards"          ON cards;
DROP POLICY IF EXISTS "allow_all_rounds"         ON rounds;
DROP POLICY IF EXISTS "allow_all_round_cards"    ON round_cards;
DROP POLICY IF EXISTS "allow_all_scores"         ON scores;
DROP POLICY IF EXISTS "allow_all_player_stats"   ON player_stats;
DROP POLICY IF EXISTS "allow_all_players_meta"   ON players_meta;
DROP POLICY IF EXISTS "allow_all_player_seasons" ON player_seasons;

-- Drop policies created below, so re-running this script never errors.
DROP POLICY IF EXISTS "cards_public_select"          ON cards;
DROP POLICY IF EXISTS "players_public_select"        ON players;
DROP POLICY IF EXISTS "players_public_insert"        ON players;
DROP POLICY IF EXISTS "players_public_update"        ON players;
DROP POLICY IF EXISTS "rooms_public_select"          ON rooms;
DROP POLICY IF EXISTS "rooms_public_insert"          ON rooms;
DROP POLICY IF EXISTS "rooms_public_update"          ON rooms;
DROP POLICY IF EXISTS "teams_public_select"          ON teams;
DROP POLICY IF EXISTS "teams_public_insert"          ON teams;
DROP POLICY IF EXISTS "teams_public_delete"          ON teams;
DROP POLICY IF EXISTS "room_players_public_select"   ON room_players;
DROP POLICY IF EXISTS "room_players_public_insert"   ON room_players;
DROP POLICY IF EXISTS "room_players_public_update"   ON room_players;
DROP POLICY IF EXISTS "room_players_public_delete"   ON room_players;
DROP POLICY IF EXISTS "rounds_public_select"         ON rounds;
DROP POLICY IF EXISTS "rounds_public_insert"         ON rounds;
DROP POLICY IF EXISTS "rounds_public_update"         ON rounds;
DROP POLICY IF EXISTS "round_cards_public_select"    ON round_cards;
DROP POLICY IF EXISTS "round_cards_public_insert"    ON round_cards;
DROP POLICY IF EXISTS "round_cards_public_update"    ON round_cards;
DROP POLICY IF EXISTS "scores_public_select"         ON scores;
DROP POLICY IF EXISTS "scores_public_insert"         ON scores;
DROP POLICY IF EXISTS "scores_public_update"         ON scores;
DROP POLICY IF EXISTS "player_stats_public_select"   ON player_stats;

-- ============================================================
-- 3. CARDS — the deck is public READ-ONLY
--    Frontend reads it two ways: pick_random_cards() RPC and the
--    embedded join `card:cards(*)` in fetchRoundCards. No policy for
--    INSERT/UPDATE/DELETE => anon writes are denied by RLS. The
--    scraper (--to-cards) writes with service_role, which bypasses RLS.
-- ============================================================
CREATE POLICY "cards_public_select" ON cards
  FOR SELECT TO anon, authenticated USING (true);

-- Belt-and-braces: also revoke write grants from the public roles.
REVOKE INSERT, UPDATE, DELETE ON cards FROM anon, authenticated;

-- ============================================================
-- 4. SCRAPER TABLES — fully private (service_role only)
--    No policies at all + grants revoked. service_role bypasses RLS
--    and keeps its own grants, so football_scraper is unaffected
--    (once it uses the service_role key — see prerequisite).
-- ============================================================
REVOKE ALL ON players_meta   FROM anon, authenticated;
REVOKE ALL ON player_seasons FROM anon, authenticated;
REVOKE ALL ON SEQUENCE players_meta_id_seq   FROM anon, authenticated;
REVOKE ALL ON SEQUENCE player_seasons_id_seq FROM anon, authenticated;

-- ============================================================
-- 5. MULTIPLAYER TABLES — exactly the operations the frontend does
--    (see analysis in the accompanying notes; realtime subscriptions
--    need SELECT, which every table below has)
-- ============================================================

-- players: useAuth upserts the Telegram profile (INSERT + UPDATE),
-- joinRoom/fetchRoomPlayers read names. No DELETE in the app.
CREATE POLICY "players_public_select" ON players
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "players_public_insert" ON players
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "players_public_update" ON players
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE DELETE ON players FROM anon, authenticated;

-- rooms: SELECT (join by code, fetchRoom, realtime), UPDATE (status /
-- current_round_id / started_at / ended_at). INSERT normally happens
-- inside the create_1v1_room / create_team_room RPCs; the INSERT
-- policy keeps room creation working even if create_team_room is not
-- SECURITY DEFINER (its definition is not in the repo — see notes).
-- No DELETE in the app.
CREATE POLICY "rooms_public_select" ON rooms
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rooms_public_insert" ON rooms
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rooms_public_update" ON rooms
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE DELETE ON rooms FROM anon, authenticated;

-- teams: SELECT (fetchTeams, get_room_scores), INSERT (1v1 join
-- creates the second team), DELETE (1v1 leave removes the player's
-- team). No UPDATE in the app.
CREATE POLICY "teams_public_select" ON teams
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "teams_public_insert" ON teams
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "teams_public_delete" ON teams
  FOR DELETE TO anon, authenticated USING (true);
REVOKE UPDATE ON teams FROM anon, authenticated;

-- room_players: all four operations are used (join = insert/upsert,
-- assignTeam = update team_id, leaveRoom = delete, lobby reads).
CREATE POLICY "room_players_public_select" ON room_players
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "room_players_public_insert" ON room_players
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "room_players_public_update" ON room_players
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "room_players_public_delete" ON room_players
  FOR DELETE TO anon, authenticated USING (true);

-- rounds: INSERT (startGame), UPDATE (activate / complete), SELECT
-- (useGame + realtime). No DELETE in the app.
CREATE POLICY "rounds_public_select" ON rounds
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rounds_public_insert" ON rounds
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rounds_public_update" ON rounds
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE DELETE ON rounds FROM anon, authenticated;

-- round_cards: INSERT (activateRound deals the hand), UPDATE
-- (markCard correct/skipped), SELECT (fetchRoundCards + realtime).
-- No DELETE in the app.
CREATE POLICY "round_cards_public_select" ON round_cards
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "round_cards_public_insert" ON round_cards
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "round_cards_public_update" ON round_cards
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE DELETE ON round_cards FROM anon, authenticated;

-- scores: upsert at round end (INSERT + UPDATE), reads for the
-- summary + realtime. No DELETE in the app.
CREATE POLICY "scores_public_select" ON scores
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "scores_public_insert" ON scores
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "scores_public_update" ON scores
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE DELETE ON scores FROM anon, authenticated;

-- player_stats: frontend only SELECTs (usePlayerStats); all writes go
-- through increment_player_stats(), which is SECURITY DEFINER and
-- bypasses RLS. No public write policies.
CREATE POLICY "player_stats_public_select" ON player_stats
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON player_stats FROM anon, authenticated;

-- ============================================================
-- 6. RPC SANITY
--    pick_random_cards  — SECURITY INVOKER (default) + STABLE. It
--      keeps working under RLS because of "cards_public_select".
--    get_room_scores    — INVOKER; covered by teams/scores SELECT.
--    increment_player_stats — already SECURITY DEFINER. OK.
--    create_1v1_room        — already SECURITY DEFINER. OK.
--    create_team_room   — referenced by the frontend but NOT in the
--      repo. The rooms/teams/room_players INSERT policies above keep
--      it working either way. To inspect it, run:
--
--        SELECT proname, prosecdef AS is_security_definer
--        FROM pg_proc
--        WHERE proname IN ('create_team_room', 'create_1v1_room',
--                          'pick_random_cards', 'get_room_scores',
--                          'increment_player_stats');
--
-- Hardening for the DEFINER functions (fixes the related Supabase
-- linter warning "function has a role mutable search_path"):
ALTER FUNCTION increment_player_stats(BIGINT, INT, INT, INT, INT)
  SET search_path = public;
ALTER FUNCTION create_1v1_room(BIGINT, JSONB)
  SET search_path = public;

-- ============================================================
-- 6b. NON-DML PRIVILEGES — TRUNCATE is NOT governed by RLS, and the
--     default grants hand it (plus TRIGGER/REFERENCES) to the public
--     roles: anyone with the anon key from the frontend bundle could
--     wipe cards/rooms/scores in one statement. The app never uses
--     these — revoke everywhere. (Found on prod 2026-07-18.)
-- ============================================================
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ============================================================
-- 7. VERIFY (run after; both should look right before testing the app)
-- ============================================================
-- RLS enabled everywhere:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' ORDER BY tablename;
-- Policies per table/operation:
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' ORDER BY tablename, cmd;
