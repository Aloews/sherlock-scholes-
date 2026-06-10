-- ============================================================
-- SHERLOCK SCHOLES — Migration: difficulty / pageviews filter
-- Adds a Wikipedia pageviews score to `cards` and lets
-- pick_random_cards() gate the deck by a minimum threshold,
-- backing the global Easy/Hard toggle on the home screen.
--   easy → pageviews > 19000 (most famous players)
--   hard → pageviews > 3000  (wider, less mainstream pool)
-- Cards with no pageviews score (clubs, terms, …) always pass,
-- so the deck keeps working until player pageviews are backfilled.
-- Run manually in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS pageviews BIGINT;

-- Partial index helps the threshold scan once pageviews are populated.
CREATE INDEX IF NOT EXISTS idx_cards_pageviews
  ON cards(pageviews) WHERE pageviews IS NOT NULL;

-- Adding a parameter creates a new overload; drop the old 2-arg
-- signature first so callers don't hit an ambiguous match.
DROP FUNCTION IF EXISTS pick_random_cards(INT, TEXT[]);

CREATE OR REPLACE FUNCTION pick_random_cards(
  p_count         INT,
  p_categories    TEXT[]  DEFAULT NULL,
  p_min_pageviews BIGINT  DEFAULT NULL
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
    ORDER BY random()
    LIMIT p_count;
END;
$$ LANGUAGE plpgsql STABLE;
