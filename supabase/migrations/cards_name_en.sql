-- ============================================================
-- SHERLOCK SCHOLES — Migration: cards.name_en
-- English display name for player cards, copied from
-- players_meta.name_en by the --to-cards step (for the future
-- EN language toggle in the game). NULL for old cards and for
-- non-player categories; the game ignores it until the toggle
-- ships, so nothing breaks.
-- Run manually in the Supabase SQL Editor. Idempotent.
--
-- NOTE: pick_random_cards() RETURNS SETOF cards, so the new
-- column flows through the RPC automatically — no function
-- change needed. Run this BEFORE the next `run.py --to-cards`,
-- otherwise the insert fails with "column not found" (PGRST204).
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS name_en TEXT;
