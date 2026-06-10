-- ============================================================
-- SHERLOCK SCHOLES — Migration: grant scraper tables to service_role
-- ============================================================
-- WHY: rls_lockdown.sql assumed service_role already held grants on the
-- scraper tables ("service_role bypasses RLS and keeps its own grants").
-- On this project it never had them, so the scraper's first run with the
-- service_role key failed:
--   403 / 42501 permission denied for table players_meta
--
-- RLS bypass does not help without table-level privileges — both are
-- required. This grants the privileges; RLS stays exactly as locked down.
--
-- Run once in Supabase Dashboard -> SQL Editor.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON players_meta   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON player_seasons TO service_role;
GRANT USAGE, SELECT ON SEQUENCE players_meta_id_seq   TO service_role;
GRANT USAGE, SELECT ON SEQUENCE player_seasons_id_seq TO service_role;

-- --to-cards step: scraper also reads/inserts cards with the same key.
-- (cards.id is UUID — no sequence to grant.)
GRANT SELECT, INSERT, UPDATE ON cards TO service_role;
