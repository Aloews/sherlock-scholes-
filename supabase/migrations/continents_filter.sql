-- ============================================================
-- SHERLOCK SCHOLES — Migration: player continents filter
-- Adds cards.continent and lets pick_random_cards() narrow PLAYER
-- cards by continent (the quick-game "Игроки" accordion).
-- Run manually in the Supabase SQL Editor.
--
-- Frontend contract (src/features/game/cardRandomizer.ts):
--   * works BEFORE this migration — it drops p_continents after the
--     first PGRST202 and plays without the filter;
--   * p_continents values: 'europe', 'south_america', 'africa',
--     'asia', 'north_america', plus the sentinel 'other' meaning
--     continent IS NULL ("Прочие" — continent not yet backfilled).
--   * Only player cards are filtered; clubs/terms/etc always pass.
--
-- cards.continent stays NULL for every row until backfilled, so right
-- after this migration all players sit under "Прочие". Backfill is a
-- separate data task (football_scraper).
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS continent TEXT;

-- Partial index for the filter scan once continents are populated.
CREATE INDEX IF NOT EXISTS idx_cards_continent
  ON cards(continent) WHERE continent IS NOT NULL;

-- Adding a parameter creates a new overload; drop the old 3-arg
-- signature first so callers don't hit an ambiguous match.
-- (3-arg calls keep working: p_continents has a DEFAULT.)
DROP FUNCTION IF EXISTS pick_random_cards(INT, TEXT[], BIGINT);

CREATE OR REPLACE FUNCTION pick_random_cards(
  p_count         INT,
  p_categories    TEXT[]  DEFAULT NULL,
  p_min_pageviews BIGINT  DEFAULT NULL,
  p_continents    TEXT[]  DEFAULT NULL
)
RETURNS SETOF cards AS $$
BEGIN
  RETURN QUERY
    SELECT *
    FROM cards
    WHERE active = TRUE
      AND (
        p_categories IS NULL
        OR cardinality(p_categories) = 0
        OR category = ANY(p_categories)
      )
      AND (
        p_min_pageviews IS NULL
        OR pageviews IS NULL          -- non-player cards have no score → keep
        OR pageviews > p_min_pageviews
      )
      AND (
        p_continents IS NULL
        OR cardinality(p_continents) = 0
        OR category <> 'player'       -- continent filter touches players only
        OR continent = ANY(p_continents)
        OR (continent IS NULL AND 'other' = ANY(p_continents))
      )
    ORDER BY random()
    LIMIT p_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Tell PostgREST the function signature changed (Supabase usually
-- reloads on its own; this makes it immediate).
NOTIFY pgrst, 'reload schema';
