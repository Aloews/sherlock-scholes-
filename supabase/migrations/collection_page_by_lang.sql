-- ============================================================
-- SHERLOCK SCHOLES — Migration: the Collection sorts by the VIEWER's language
--
-- Before this migration the Collection screen ordered by `cards.pageviews`,
-- and that column is ru-wiki views ONLY. Every player in the world — French,
-- Korean, Brazilian — browsed the deck in Russian popularity order, so the
-- «Клубы» tab opened on «Зенит». Measured in docs/PLAYER_ATTENTION_ANALYSIS.md
-- §2: rank correlation of `pageviews` with the real multilingual axis is
-- 0.172, mean percentile shift 31 points, 55 % of cards move by 25+.
--
-- The language views live in `cards.pageviews_i18n` (jsonb, one key per
-- language, filled by docs/cards_pageviews_i18n.py).
--
-- ── Why an RPC and not just another .order() ────────────────────────────
-- PostgREST sorts `pageviews_i18n->>'fr'` as TEXT, so "9" sorts above
-- "10000" and the tab would be shuffled rather than translated. The cast to
-- bigint has to happen in SQL, which means a function.
--
-- ── The ordering metric, and why it is COALESCE and not GREATEST ────────
-- The obvious sketch is `greatest(lang_views, pageviews)` — "take whichever
-- is bigger, so a card is never buried". It does not work: «Зенит» has
-- pageviews 523 129 (and that number is not even the club — see below), so
-- greatest() returns the Russian score for a French viewer and «Зенит» stays
-- exactly where the complaint started. GREATEST cannot express a fallback;
-- it expresses a maximum, and the maximum is always the Russian column.
--
-- What is actually wanted is "the viewer's language IF WE HAVE IT, else the
-- Russian order as a stand-in" — which is COALESCE over a precedence list:
--
--   1. pageviews_i18n ->> lang     the viewer's own language, when collected
--   2. lang = 'ru' -> pageviews    ru has always lived in the scalar column;
--                                  cards filled before ru joined LANGS carry
--                                  no 'ru' key and must not read as zero
--   3. 0                           we do not know this card in this language
--
-- Step 3 is what fixes the complaint: a Russian club with no French article
-- scores 0 for a French viewer instead of borrowing its Russian fame.
--
-- ── Why "else the Russian order" is a TIEBREAK and not a fallback value ──
-- The first version of this function had a fourth branch: a card with no
-- language data at all fell back to cards.pageviews, on the reasoning that
-- Russian order beats random order. That shipped, and it was wrong — not
-- in principle but in ARITHMETIC. A Russian pageview count and a Korean one
-- are not on the same scale: ru numbers run to the hundreds of thousands,
-- ko numbers to the tens of thousands. Mixing them in one sort key means the
-- unprocessed card always wins. Production, Korean, «Клубы», top three:
--
--     Брест        255 299   <- no language data; the BELARUSIAN CITY's
--     Монреаль     149 395      Russian views, standing in for a club
--     Дюссельдорф  132 407
--     ...
--     Тоттенхэм     23 809   <- an actual Korean pageview count
--
-- The three cards the P31 guard refused (so they carry a city's score, see
-- cards_pageviews_i18n.py) floated to the TOP of the very language they
-- were least known in. Worse than the «Зенит» this migration set out to fix.
--
-- The intent was right and is kept, as a SECOND sort key: cards we know in
-- this language rank first, ordered by that language; everything else forms
-- a tail behind them, ordered by cards.pageviews — Russian order, still
-- better than random, but never competing with a real measurement.
--
-- ── This does NOT touch the deck ────────────────────────────────────────
-- The deck is one filter and one predicate (docs/MAP.md §3): cards_matching,
-- wrapped by pick_random_cards and count_deck. The Collection is a catalog
-- browse, not a deal — it never fed that predicate and does not now. Nothing
-- here is a second way to pick cards; collection_page cannot deal a card.
-- ============================================================

-- The ordering metric, in ONE place, so the API and any future caller can
-- never disagree about what "most known here" means.
--
-- IMMUTABLE + a regex-guarded cast: a non-numeric value in the jsonb would
-- otherwise abort the whole page with a cast error. Only the collector writes
-- this column and it writes integers, but a sort must not be one bad row away
-- from a 500.
CREATE OR REPLACE FUNCTION public.collection_views(
  p_pageviews bigint,
  p_i18n      jsonb,
  p_lang      text
) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    CASE WHEN p_i18n ->> p_lang ~ '^[0-9]+$'
         THEN (p_i18n ->> p_lang)::bigint END,
    CASE WHEN p_lang = 'ru' THEN p_pageviews END,
    0
  );
$$;

COMMENT ON FUNCTION public.collection_views(bigint, jsonb, text) IS
  'Views of a card in ONE language for Collection ordering: pageviews_i18n->>lang, '
  'or cards.pageviews when the language IS ru, else 0. Never mixes scales: a card '
  'unknown in this language scores 0 and is ordered by the caller''s tiebreak.';

-- One page of the Collection catalog.
--
-- SECURITY INVOKER (the default) on purpose: `cards` has RLS
-- (rls_lockdown.sql, policy cards_public_select) and this function must read
-- under the caller's rights, exactly as the direct select it replaces did.
-- SECURITY DEFINER here would hand the anon key a way around that policy.
--
-- p_query is a bind parameter, so the search box no longer has to be
-- sanitized against PostgREST's `or=(…)` filter syntax — a comma or a paren
-- is now just text, and «Интер (Майами)» is findable by typing it.
CREATE OR REPLACE FUNCTION public.collection_page(
  p_lang     text,
  p_category text DEFAULT NULL,
  p_query    text DEFAULT NULL,
  p_limit    int  DEFAULT 48,
  p_offset   int  DEFAULT 0
) RETURNS SETOF cards
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT c.*
  FROM cards c
  WHERE c.active
    AND (p_category IS NULL OR p_category = '' OR c.category = p_category)
    AND (p_query IS NULL OR p_query = ''
         OR c.name ILIKE '%' || p_query || '%'
         OR c.name_en ILIKE '%' || p_query || '%')
  ORDER BY
    collection_views(c.pageviews, c.pageviews_i18n, left(COALESCE(p_lang, 'ru'), 2)) DESC,
    -- The tail: everything we cannot measure in this language, in Russian
    -- popularity order. Second key, never merged into the first — see the
    -- «Брест» arithmetic above. For a ru viewer this is the same number as
    -- the first key, so it changes nothing there.
    COALESCE(c.pageviews, 0) DESC,
    -- `name` breaks the remaining ties so paging stays stable: without it
    -- cards equal on both keys come back in arbitrary order and repeat
    -- across pages.
    c.name ASC
  LIMIT  GREATEST(COALESCE(p_limit, 48), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.collection_page(text, text, text, int, int) IS
  'One page of the Collection catalog, ordered by the viewer language''s '
  'Wikipedia views (see collection_views). Browse only — not a deck path.';

GRANT EXECUTE ON FUNCTION public.collection_views(bigint, jsonb, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_page(text, text, text, int, int)
  TO anon, authenticated, service_role;

-- No index for the language sort, deliberately — and it does cost something.
--
-- The metric depends on p_lang, so cards_active_browse_idx (built on
-- `pageviews desc, name` — cards_collection_index.sql) cannot serve it: that
-- index let the old query stop after 48 rows, this one has to rank every
-- matching card. Covering it properly would mean 9 languages x 2 shapes = 18
-- expression indexes on a table the nightly enrichment rewrites.
--
-- Measured on production (3364 active rows), warm, EXPLAIN ANALYZE:
--
--   case                        old (indexed ru sort)   new (language sort)
--   one category (club)                    —                   8.3 ms
--   all categories, no search           2.1 ms                21.6 ms
--   all categories, search «ар»         9.3 ms                27.9 ms
--
-- So the worst page costs ~28 ms against ~9 ms. Two things make that a fair
-- trade rather than a regression to wave through:
--   * the seq-scan baseline BEFORE cards_collection_index.sql existed was
--     36 ms, and that index was documented there as "preventive, not a cure
--     for perceived load time — the database was not the bottleneck". We are
--     spending part of a margin that was never the user's problem;
--   * ~6 ms of every number above is materializing 48 full `cards` rows,
--     which RETURNS SETOF cards requires and PostgREST needs in order to
--     embed card_translations (the localized card names — i.e. exactly the
--     audience this migration is for). The ranking itself is 2.2 ms.
--
-- A narrow sort + join back on id was tried and is WORSE (43 ms): the nested
-- loop over 48 primary-key lookups costs more than the wide top-N heapsort.
-- Revisit if the deck grows an order of magnitude, not before.

NOTIFY pgrst, 'reload schema';
