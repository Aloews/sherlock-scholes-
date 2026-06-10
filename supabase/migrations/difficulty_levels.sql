-- ============================================================
-- SHERLOCK SCHOLES — Migration: three difficulty levels + NULL fix
-- The home screen now has novice / fan / expert:
--   novice → p_min_pageviews = 19000
--   fan    → p_min_pageviews = 3000
--   expert → p_min_pageviews = NULL (whole deck)
-- FIX: previously `pageviews IS NULL` passed EVERY threshold, so
-- ~1800 manual cards leaked into novice/fan. With a threshold set,
-- NULL-pageviews cards are now EXCLUDED — they appear only in
-- expert mode (no threshold). Run --cards-pageviews to backfill
-- views so novice/fan keep a rich pool.
-- Same signature as before → CREATE OR REPLACE, no drop needed.
-- Run manually in the Supabase SQL Editor. Idempotent.
-- ============================================================

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
        -- threshold set → NULL pageviews no longer passes (expert-only cards)
        OR (pageviews IS NOT NULL AND pageviews > p_min_pageviews)
      )
    ORDER BY random()
    LIMIT p_count;
END;
$$ LANGUAGE plpgsql STABLE;
