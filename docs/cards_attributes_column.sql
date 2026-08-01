-- ============================================================
-- SHERLOCK SCHOLES — cards.ovr + cards.attributes (JSONB)
-- Overall rating and six FIFA-style 0–100 sub-ratings, for the dossier's
-- OVR badge and "Характеристики" bars:
--   attributes: { "pace": 89, "shooting": 94, "passing": 66,
--                 "dribbling": 80, "defense": 45, "physical": 88 }
-- Schema only — there is no backfill script yet. Real per-player ratings
-- are a separate data-acquisition project (see
-- docs/PROGRESSION_FEATURES_HANDOFF.md); until it ships, no card carries
-- either column and the dossier simply omits the badge/bars.
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS ovr SMALLINT CHECK (ovr BETWEEN 0 AND 100);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS attributes JSONB;

NOTIFY pgrst, 'reload schema';
