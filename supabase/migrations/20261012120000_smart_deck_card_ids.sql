-- Smart Decks need an exact, source-backed list of cards. A thematic deck
-- cannot be represented by a broad tag alone: current-form recommendations
-- must contain the exact canonical card IDs returned by player_ratings.
-- Keep this dimension inside the single shared predicate so counting and
-- dealing can never disagree.
CREATE OR REPLACE FUNCTION public.cards_matching(p_filter jsonb)
RETURNS SETOF public.cards
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT
      CASE WHEN jsonb_typeof(p_filter -> 'categories') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'categories')) END AS categories,
      CASE WHEN jsonb_typeof(p_filter -> 'continents') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'continents')) END AS continents,
      CASE WHEN jsonb_typeof(p_filter -> 'countries') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'countries')) END AS countries,
      CASE WHEN jsonb_typeof(p_filter -> 'leagues') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'leagues')) END AS leagues,
      CASE WHEN jsonb_typeof(p_filter -> 'tags') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'tags')) END AS tags,
      CASE WHEN jsonb_typeof(p_filter -> 'clubs') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'clubs')) END AS clubs,
      CASE WHEN jsonb_typeof(p_filter -> 'card_ids') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'card_ids')) END AS card_ids,
      NULLIF(p_filter ->> 'fame_min', '')::int AS fame_min,
      NULLIF(p_filter ->> 'lang', '') AS lang
  )
  SELECT c.*
  FROM public.cards c, f
  WHERE c.active
    AND (f.card_ids IS NULL OR cardinality(f.card_ids) = 0 OR c.id::text = ANY(f.card_ids))
    AND (f.categories IS NULL OR cardinality(f.categories) = 0 OR c.category = ANY(f.categories))
    AND (f.fame_min IS NULL OR f.fame_min <= 0 OR (c.fame IS NOT NULL AND c.fame >= f.fame_min))
    AND (f.continents IS NULL OR cardinality(f.continents) = 0 OR c.category <> 'player'
         OR c.continent = ANY(f.continents) OR (c.continent IS NULL AND 'other' = ANY(f.continents)))
    AND (f.countries IS NULL OR cardinality(f.countries) = 0 OR c.category <> 'player'
         OR c.country = ANY(f.countries))
    AND (f.leagues IS NULL OR cardinality(f.leagues) = 0 OR c.category <> 'player'
         OR c.top_league = ANY(f.leagues))
    AND (f.tags IS NULL OR cardinality(f.tags) = 0 OR c.category <> 'player' OR c.tags && f.tags)
    AND (f.clubs IS NULL OR cardinality(f.clubs) = 0 OR c.category <> 'player'
         OR EXISTS (SELECT 1 FROM public.card_current_club cc
                    WHERE cc.card_id = c.id AND cc.club_key = ANY(f.clubs)))
    AND (c.langs IS NULL OR f.lang IS NULL OR f.lang = ANY(c.langs));
$$;

COMMENT ON FUNCTION public.cards_matching(jsonb) IS
'Canonical deck predicate. card_ids constrains Smart Decks to verified canonical card IDs; count and deal reuse this predicate.';
