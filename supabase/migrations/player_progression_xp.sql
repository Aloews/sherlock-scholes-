-- ============================================================
-- SHERLOCK SCHOLES — Migration: player progression, phase 1 (levels & XP)
--
-- Adds player_stats.xp and teaches increment_player_stats() to award it
-- alongside the existing counters, inside the same SECURITY DEFINER call
-- the room-end flow already makes (src/features/room/roomService.ts).
-- No new RPC and no client-supplied XP amount: the gain is computed here
-- from the same game-outcome inputs the function already trusts, so it
-- can't be forged from the console the way a client-side increment could.
--
-- Level is derived from xp on the client (src/shared/lib/level.ts) and not
-- stored: level = floor(sqrt(xp / 100)) + 1.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

-- XP sources (docs/PROGRESSION_FEATURES_HANDOFF.md §1.3): +10 per card
-- guessed, +50 for winning the game. Daily-task rewards are credited
-- separately once player_daily_tasks exists (phase 4).
CREATE OR REPLACE FUNCTION increment_player_stats(
  p_player_id     BIGINT,
  p_games_played  INT DEFAULT 1,
  p_games_won     INT DEFAULT 0,
  p_cards_guessed INT DEFAULT 0,
  p_total_score   INT DEFAULT 0
) RETURNS VOID AS $$
DECLARE
  v_xp_gained INT := p_cards_guessed * 10 + p_games_won * 50;
BEGIN
  INSERT INTO player_stats (player_id, games_played, games_won, cards_guessed, total_score, xp)
  VALUES (p_player_id, p_games_played, p_games_won, p_cards_guessed, p_total_score, v_xp_gained)
  ON CONFLICT (player_id) DO UPDATE SET
    games_played  = player_stats.games_played  + EXCLUDED.games_played,
    games_won     = player_stats.games_won     + EXCLUDED.games_won,
    cards_guessed = player_stats.cards_guessed + EXCLUDED.cards_guessed,
    total_score   = player_stats.total_score   + EXCLUDED.total_score,
    xp            = player_stats.xp            + EXCLUDED.xp,
    updated_at    = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- player_stats already has no public INSERT/UPDATE/DELETE grant and a public
-- SELECT policy (supabase/migrations/rls_lockdown.sql) — the new column
-- inherits that as-is, nothing to add here.
