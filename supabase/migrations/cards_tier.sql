-- ============================================================
-- SHERLOCK SCHOLES — cards.tier (rarity for the collectible mechanic)
-- One of: 'legendary' | 'epic' | 'rare' | 'common'.
-- Derived from data we already have (pageviews + facts.titles /
-- facts.tournaments + tags) by docs/cards_tier_build.py (APPLY=1).
-- Idempotent backfill; the column is plain TEXT (no enum) so the tier
-- logic can evolve without a migration.
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS tier TEXT;

NOTIFY pgrst, 'reload schema';
