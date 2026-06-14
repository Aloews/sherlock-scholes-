-- ============================================================
-- SHERLOCK SCHOLES — Migration: pick_random_cards p_tags filter
-- Adds the p_tags parameter (special-category filter via cards.tags)
-- to pick_random_cards(), keeping the existing
-- p_count / p_categories / p_min_pageviews / p_continents signature.
-- Run manually in the Supabase SQL Editor AFTER cards.tags is populated.
--
-- Frontend contract (src/features/game/cardRandomizer.ts):
--   * works BEFORE this migration — drops p_tags after the first
--     PGRST202 and plays without the tag filter;
--   * p_tags values are the special tags: 'goalkeeper', 'ballon_dor',
--     'giant', 'dwarf', 'world_cup', 'star'.
--   * cards.tags is NULL on non-player cards, so selecting any tag
--     naturally restricts the deck to the matching player cards;
--     continent/category filters still compose via AND.
--   * needs the tags column + GIN index (cards.facts/tags ALTER).
--
-- Adding a parameter creates a new overload; drop the old 4-arg
-- signature first so callers don't hit an ambiguous match.
-- (4-arg calls keep working: p_tags has a DEFAULT.)
-- ============================================================

DROP FUNCTION IF EXISTS pick_random_cards(INT, TEXT[], BIGINT, TEXT[]);

CREATE OR REPLACE FUNCTION pick_random_cards(
  p_count         INT,
  p_categories    TEXT[]  DEFAULT NULL,
  p_min_pageviews BIGINT  DEFAULT NULL,
  p_continents    TEXT[]  DEFAULT NULL,
  p_tags          TEXT[]  DEFAULT NULL
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
      AND (
        p_tags IS NULL
        OR cardinality(p_tags) = 0
        OR tags && p_tags             -- GIN-indexed overlap; tags NULL → excluded
      )
    ORDER BY random()
    LIMIT p_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Tell PostgREST the function signature changed.
NOTIFY pgrst, 'reload schema';
