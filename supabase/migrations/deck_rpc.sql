-- ============================================================
-- SHERLOCK SCHOLES — Migration: ONE canonical deck contract
--
-- What this replaces
-- ------------------
-- pick_random_cards had grown to 12 positional parameters, added one
-- migration at a time (p_continents, p_tags, p_init_data, p_difficulty,
-- p_boost_countries, p_lang, p_countries, p_leagues, p_tiers). The client
-- carried six `rpcSupportsX` booleans to guess which of them the deployed
-- database understood, retrying the call after each PGRST202.
--
-- The counter was worse: the picker's "N карточек" was NOT this function.
-- countDeck() rebuilt the WHERE clause by hand out of PostgREST filters and
-- silently omitted the onboarding floor, the langs filter and the Pro
-- check — so the number under the button described a deck the game would
-- never deal.
--
-- What it is now
-- --------------
--   cards_matching(filter)  the ONE predicate. Everything else calls it.
--   pick_random_cards(filter, count, init_data)   deal
--   count_deck(filter, init_data)                 count the same deck
--
-- The count and the draw are the same SQL, so they cannot drift again.
--
-- The filter is one jsonb object — adding a dimension later is a key, not a
-- parameter, and never an ambiguous overload:
--
--   { "categories":  ["player","club"],   -- null/absent = every category
--     "continents":  ["europe","africa"], -- 'other' = continent IS NULL
--     "countries":   ["FR","BR"],         -- ISO, as in cards.country
--     "leagues":     ["Premier League"],  -- see deck_leagues()
--     "tags":        ["goalkeeper"],      -- cards.tags overlap
--     "fame_min":    60,                  -- 0..100, see deck_fame.sql
--     "lang":        "ru" }               -- interface language
--
-- Two rules make the filter behave the way the picker reads:
--
--   * continents / countries / leagues / tags describe PLAYERS. They never
--     remove a club or a stadium — pick "вратари + клубы" and you get
--     goalkeepers and clubs, not an empty deck. This is what let the client
--     drop its two-pool merge in pickRandomCards().
--   * fame_min describes EVERY card. Asking for famous cards no longer
--     leaves an obscure club in the deck just because clubs were not
--     players.
--
-- Pro-only tags stay server-enforced: they are stripped unless the signed
-- initData maps to users.is_pro (see pro_deck.sql).
-- ============================================================

-- ── Pro guard (pro_deck.sql was never actually applied to prod) ──────
-- The old client only sent p_init_data when a pro tag was requested and
-- dropped it after the first PGRST202 — which is exactly what happened on
-- every call, so "server-side Pro enforcement" existed only on paper. The
-- new contract always routes through deck_sanitize_filter, so the two
-- functions it needs are (re)created here.
CREATE OR REPLACE FUNCTION public.pro_only_tags()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['legend','ballon_dor']::text[] $$;

CREATE OR REPLACE FUNCTION public.tg_is_pro(p_init_data text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_id bigint;
  v_is_pro boolean;
BEGIN
  IF p_init_data IS NULL OR p_init_data = '' THEN
    RETURN false;
  END IF;
  v_id := tg_validate_init_data(p_init_data);
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT is_pro INTO v_is_pro FROM users WHERE telegram_id = v_id;
  RETURN coalesce(v_is_pro, false);
END;
$$;

REVOKE ALL ON FUNCTION public.tg_is_pro(text) FROM public;
GRANT EXECUTE ON FUNCTION public.pro_only_tags() TO anon, authenticated, service_role;

-- ── The predicate ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cards_matching(p_filter jsonb)
RETURNS SETOF cards
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
      NULLIF(p_filter ->> 'fame_min', '')::int AS fame_min,
      NULLIF(p_filter ->> 'lang', '')          AS lang
  )
  SELECT c.*
  FROM cards c, f
  WHERE c.active
    AND (f.categories IS NULL OR cardinality(f.categories) = 0
         OR c.category = ANY(f.categories))
    -- Recognizability applies to every card. NULL fame = unknown, which is
    -- never "famous": such cards show up only with no floor at all.
    AND (f.fame_min IS NULL OR f.fame_min <= 0
         OR (c.fame IS NOT NULL AND c.fame >= f.fame_min))
    -- Player-shaped filters below: they narrow players, never non-players.
    AND (f.continents IS NULL OR cardinality(f.continents) = 0
         OR c.category <> 'player'
         OR c.continent = ANY(f.continents)
         OR (c.continent IS NULL AND 'other' = ANY(f.continents)))
    AND (f.countries IS NULL OR cardinality(f.countries) = 0
         OR c.category <> 'player'
         OR c.country = ANY(f.countries))
    AND (f.leagues IS NULL OR cardinality(f.leagues) = 0
         OR c.category <> 'player'
         OR c.top_league = ANY(f.leagues))
    AND (f.tags IS NULL OR cardinality(f.tags) = 0
         OR c.category <> 'player'
         OR c.tags && f.tags)
    -- Cards that only make sense in some cultures (commentators) carry an
    -- explicit language list; everything else passes.
    AND (c.langs IS NULL OR f.lang IS NULL OR f.lang = ANY(c.langs));
$$;

-- ── Pro enforcement, applied once for both entry points ──────────────
-- Strips pro-only tags from the filter unless initData proves Pro. A
-- request that was ONLY pro tags becomes an impossible tag (empty deck)
-- rather than silently widening to "everything".
CREATE OR REPLACE FUNCTION public.deck_sanitize_filter(p_filter jsonb, p_init_data text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_tags text[];
  v_kept text[];
BEGIN
  IF jsonb_typeof(p_filter -> 'tags') <> 'array' THEN
    RETURN COALESCE(p_filter, '{}'::jsonb);
  END IF;

  v_tags := ARRAY(SELECT jsonb_array_elements_text(p_filter -> 'tags'));
  IF cardinality(v_tags) = 0 OR NOT (v_tags && pro_only_tags()) OR tg_is_pro(p_init_data) THEN
    RETURN p_filter;
  END IF;

  v_kept := ARRAY(SELECT t FROM unnest(v_tags) t WHERE NOT (t = ANY(pro_only_tags())));
  IF cardinality(v_kept) = 0 THEN
    v_kept := ARRAY['__pro_locked__'];
  END IF;

  RETURN jsonb_set(p_filter, '{tags}', to_jsonb(v_kept));
END;
$$;

-- ── Entry point 1: deal ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pick_random_cards(
  p_filter    jsonb,
  p_count     integer DEFAULT 50,
  p_init_data text    DEFAULT NULL
) RETURNS SETOF cards
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT * FROM cards_matching(deck_sanitize_filter(p_filter, p_init_data))
  ORDER BY random()
  LIMIT greatest(coalesce(p_count, 50), 1);
$$;

-- ── Entry point 2: count the very same deck ──────────────────────────
CREATE OR REPLACE FUNCTION public.count_deck(
  p_filter    jsonb,
  p_init_data text DEFAULT NULL
) RETURNS bigint
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT count(*) FROM cards_matching(deck_sanitize_filter(p_filter, p_init_data));
$$;

-- ── TEMPORARY: the old 12-parameter signature ────────────────────────
-- Dropping it outright took production down: the database ships ahead of
-- the frontend, and the deployed build calls pick_random_cards with
-- positional parameters — it got PGRST202 and dealt no cards at all.
--
-- The two signatures coexist without ambiguity because PostgREST resolves
-- an overload by the parameter NAMES in the request body: the old client
-- always sends p_categories/p_min_pageviews (absent from the new one) and
-- the new client sends p_filter (absent from the old one).
--
-- Body is the pre-rework one, verbatim, over the raw columns. DELETE THIS
-- once the new frontend is live everywhere:
--   DROP FUNCTION public.pick_random_cards(integer,text[],bigint,text[],text[],text,integer,text[],text,text[],text[],text[]);
CREATE OR REPLACE FUNCTION public.pick_random_cards(
  p_count integer,
  p_categories text[] DEFAULT NULL,
  p_min_pageviews bigint DEFAULT NULL,
  p_continents text[] DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_init_data text DEFAULT NULL,
  p_difficulty integer DEFAULT NULL,
  p_boost_countries text[] DEFAULT NULL,
  p_lang text DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_leagues text[] DEFAULT NULL,
  p_tiers text[] DEFAULT NULL
) RETURNS SETOF cards
  LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select *
  from cards
  where active = true
    and (p_categories is null or cardinality(p_categories) = 0 or category = any(p_categories))
    and (p_min_pageviews is null or pageviews is null or pageviews > p_min_pageviews)
    and (
      p_continents is null or cardinality(p_continents) = 0
      or category <> 'player'
      or continent = any(p_continents)
      or (continent is null and 'other' = any(p_continents))
    )
    and (
      p_countries is null or cardinality(p_countries) = 0
      or category <> 'player'
      or country = any(p_countries)
    )
    and (
      p_leagues is null or cardinality(p_leagues) = 0
      or category <> 'player'
      or top_league = any(p_leagues)
    )
    and (
      p_tiers is null or cardinality(p_tiers) = 0
      or category <> 'player'
      or tier = any(p_tiers)
    )
    and (p_tags is null or cardinality(p_tags) = 0 or tags && p_tags)
    and (langs is null or p_lang is null or p_lang = any(langs))
    and (
      p_difficulty is null or p_difficulty <= 0
      or tier in ('legendary', 'epic')
      or (p_lang is not null and (pageviews_i18n ->> p_lang) is not null
          and (pageviews_i18n ->> p_lang)::bigint >= p_difficulty)
      or pageviews >= p_difficulty
      or (p_boost_countries is not null and category = 'player'
          and country = any(p_boost_countries)
          and coalesce(pageviews, 0) >= greatest(p_difficulty / 4, 1))
    )
  order by random()
  limit p_count;
$function$;

GRANT EXECUTE ON FUNCTION public.pick_random_cards(integer,text[],bigint,text[],text[],text,integer,text[],text,text[],text[],text[])
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cards_matching(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pick_random_cards(jsonb, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_deck(jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deck_leagues() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deck_sanitize_filter(jsonb, text) FROM public;

NOTIFY pgrst, 'reload schema';
