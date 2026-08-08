-- ============================================================
-- SHERLOCK SCHOLES — Migration: deal from the cards the PLAYER can guess
--
-- Two requests, one mechanism:
--
--   * a beginner's first games must be guessable, to lower the barrier;
--   * a competitive room that asks for many cards should still get cards
--     known in its players' language, not obscure ones.
--
-- Both are "rank by how well known the card is TO THIS PLAYER, and deal
-- from the top of that ranking". The axis already exists — collection_views
-- (collection_page_by_lang.sql), which reads pageviews_i18n->>lang and is
-- the single definition of "how known here" the Collection sorts by.
--
-- ── Why cards.fame could not do this ────────────────────────────────────
-- The onboarding floor (DeckFilter.fame_min, src/features/game/onboarding.ts)
-- already narrows the deck for a new player, and it is NOT enough. cards.fame
-- is a percentile of GREATEST(pageviews_ru, max over the other languages) —
-- deliberately a MAX, so a Korean or Mexican hero ranks on his own wiki
-- (deck_fame.sql). That makes fame mean "famous SOMEWHERE", which is exactly
-- wrong for a beginner: «Зенит» is fame 84 on the strength of Russian views
-- alone, and a Korean novice cannot guess it. A floor on fame cannot express
-- "guessable BY YOU", because the one number has already forgotten which
-- language earned it.
--
-- ── The invariant this must not break ───────────────────────────────────
-- docs/MAP.md §3: the number under the button and the cards dealt may never
-- disagree, which is why there is ONE predicate (cards_matching) and only
-- two wrappers over it (pick_random_cards, count_deck).
--
-- `lang_pool` is therefore NOT a new way to select cards. cards_matching is
-- untouched and still decides eligibility on its own. The pool is a LIMIT
-- applied AFTER it, and — this is the part that keeps the invariant — it is
-- applied identically in BOTH wrappers. count_deck counts the pool,
-- pick_random_cards deals out of the same pool. They cannot drift, because
-- the rule is written once per wrapper against the same ranking.
--
-- ── Why a pool and not simply "the top N cards" ─────────────────────────
-- Dealing exactly the N best-known cards would answer the request literally
-- and ruin the game: every session would deal the SAME cards, and this is a
-- party game whose whole value is the next round being different. So the
-- pool is deliberately wider than the hand (the client asks for roughly 3x,
-- see src/features/game/onboarding.ts), and the hand is drawn at random from
-- inside it. The player always meets cards known in their language; which
-- ones is still a surprise.
--
-- lang_pool absent (or not a positive integer) => behaviour is exactly as
-- before this migration: uniform random over everything cards_matching
-- returned. Every existing caller keeps its current deck.
-- ============================================================

-- ── Entry point 1: deal ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pick_random_cards(
  p_filter    jsonb,
  p_count     integer DEFAULT 50,
  p_init_data text    DEFAULT NULL
) RETURNS SETOF cards
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT deck_sanitize_filter(p_filter, p_init_data) AS j
  ), cfg AS (
    SELECT
      CASE WHEN (SELECT j ->> 'lang_pool' FROM f) ~ '^[1-9][0-9]*$'
           THEN (SELECT j ->> 'lang_pool' FROM f)::int END           AS pool,
      left(COALESCE((SELECT j ->> 'lang' FROM f), 'ru'), 2)          AS lang
  ), pool AS (
    SELECT c.*
    FROM cards_matching((SELECT j FROM f)) c
    -- No pool -> a constant key, i.e. no ordering preference, and the LIMIT
    -- below lets everything through: the original uniform-random deal.
    ORDER BY CASE WHEN (SELECT pool FROM cfg) IS NULL THEN 0
                  ELSE collection_views(c.pageviews, c.pageviews_i18n,
                                        (SELECT lang FROM cfg))
             END DESC
    LIMIT COALESCE((SELECT pool FROM cfg), 2147483647)
  )
  SELECT * FROM pool
  ORDER BY random()
  LIMIT greatest(coalesce(p_count, 50), 1);
$$;

-- ── Entry point 2: count the very same deck ──────────────────────────
-- LEAST(count, pool): the counter must promise what the deal can honour.
-- Without this the picker would advertise 3287 cards and the room would
-- only ever meet the top 90 — precisely the drift docs/MAP.md §3 forbids.
CREATE OR REPLACE FUNCTION public.count_deck(
  p_filter    jsonb,
  p_init_data text DEFAULT NULL
) RETURNS bigint
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT deck_sanitize_filter(p_filter, p_init_data) AS j
  ), cfg AS (
    SELECT CASE WHEN (SELECT j ->> 'lang_pool' FROM f) ~ '^[1-9][0-9]*$'
                THEN (SELECT j ->> 'lang_pool' FROM f)::int END AS pool
  )
  SELECT LEAST(
           (SELECT count(*) FROM cards_matching((SELECT j FROM f))),
           COALESCE((SELECT pool FROM cfg)::bigint, 9223372036854775807)
         );
$$;

COMMENT ON FUNCTION public.pick_random_cards(jsonb, integer, text) IS
  'Deal p_count cards matching the filter. With filter.lang_pool = K, the deal '
  'is drawn at random from the K cards best known in filter.lang (see '
  'collection_views) instead of from the whole match — count_deck applies the '
  'same K, so the counter and the deal stay in agreement.';

COMMENT ON FUNCTION public.count_deck(jsonb, text) IS
  'Size of the deck pick_random_cards would deal from, capped by filter.lang_pool.';

-- The legacy 12-parameter pick_random_cards is NOT touched: production still
-- calls it positionally and dropping it took the live app down once
-- (deck_rpc.sql). It has no lang_pool and needs none.

NOTIFY pgrst, 'reload schema';
