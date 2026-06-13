-- ============================================================
-- SHERLOCK SCHOLES — cards.legend_career (JSONB)
-- Career snapshot for LEGENDS (player cards absent from API-Football,
-- i.e. clubs_minutes IS NULL), sourced from Wikidata:
--   { "clubs": [{"club": "Наполи", "years": "1984–1991"}, ...],
--     "position": "Нападающий",
--     "title": "Золотой мяч" }   // title optional
-- Backfilled by --cards-legend-career. The frontend shows the clubs
-- table (club · years) on the right, position in the line below —
-- visually matching the active players' clubs|minutes table.
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS legend_career JSONB;

NOTIFY pgrst, 'reload schema';
