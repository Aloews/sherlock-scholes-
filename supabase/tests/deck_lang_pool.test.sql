-- ============================================================
-- SHERLOCK SCHOLES — test: DeckFilter.lang_pool
--
-- Covers supabase/migrations/deck_lang_pool.sql — dealing from the cards a
-- player can actually guess, in their own language.
--
-- The assertion that guards the project's main invariant (docs/MAP.md §3) is
-- «счётчик и раздача»: count_deck must report exactly what pick_random_cards
-- can hand out. The pool is a cap applied in BOTH wrappers, and a change that
-- adds it to one and forgets the other is precisely the drift the deck rules
-- exist to prevent — so it is asserted directly, not implied.
--
-- The other one worth its own line is backward compatibility: every existing
-- caller sends no lang_pool, and their decks must not move by a single card.
--
-- HOW TO RUN — Supabase SQL Editor, or:
--     psql "$DATABASE_URL" -f supabase/tests/deck_lang_pool.test.sql
--
-- SAFETY. One transaction ending in ROLLBACK; the fixtures never survive it.
-- Fixtures use a 'ZZTESTPOOL' prefix and their own category so the counts
-- asserted here cannot depend on the real deck.
--
-- Requires: deck_rpc.sql, collection_page_by_lang.sql, deck_lang_pool.sql.
-- On success prints one row: `deck_lang_pool: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_before  bigint;
  v_after   bigint;
  v_dealt   bigint;
  v_names   text[];
BEGIN
  -- ── Backward compatibility, on the REAL deck ────────────────────────
  -- No lang_pool key at all must mean "exactly as before".
  v_before := count_deck('{"categories":["club"]}'::jsonb);
  ASSERT v_before = (SELECT count(*) FROM cards WHERE active AND category = 'club'),
    'no lang_pool must count the whole matching deck';

  -- A pool wider than the deck cannot invent cards.
  ASSERT count_deck('{"categories":["club"],"lang_pool":999999}'::jsonb) = v_before,
    'a pool larger than the deck must not change the count';

  -- Junk in the key is ignored rather than obeyed: 0, negative and
  -- non-numeric all mean "no pool", never "an empty deck".
  ASSERT count_deck('{"categories":["club"],"lang_pool":0}'::jsonb) = v_before,
    'lang_pool 0 must mean no pool, not an empty deck';
  ASSERT count_deck('{"categories":["club"],"lang_pool":-5}'::jsonb) = v_before,
    'a negative lang_pool must mean no pool';
  ASSERT count_deck('{"categories":["club"],"lang_pool":"lots"}'::jsonb) = v_before,
    'a non-numeric lang_pool must mean no pool';

  -- ── The invariant: the counter promises what the deal delivers ──────
  v_after := count_deck('{"lang":"ko","lang_pool":40}'::jsonb);
  SELECT count(*) INTO v_dealt
  FROM pick_random_cards('{"lang":"ko","lang_pool":40}'::jsonb, 500);
  ASSERT v_after = 40,
    'count_deck must report the pool, got ' || v_after;
  ASSERT v_dealt = v_after,
    'count_deck (' || v_after || ') and pick_random_cards (' || v_dealt
    || ') disagree — the pool was applied to only one wrapper';

  -- ── The pool really is the top of the player's language ────────────
  -- Fixtures: one card famous in Korean, one famous only in Russian, in a
  -- category of their own so the real deck cannot interfere.
  INSERT INTO cards (name, category, active, pageviews, pageviews_i18n) VALUES
    ('ZZTESTPOOL Знает Корея',  'ZZTESTPOOLCAT', true,    100, '{"ko":900000,"ru":100}'::jsonb),
    ('ZZTESTPOOL Знает Россия', 'ZZTESTPOOLCAT', true, 900000, '{"ko":5,"ru":900000}'::jsonb);

  -- A pool of one, read in Korean, must keep the Korean-famous card — even
  -- though the other one dwarfs it on cards.pageviews and on cards.fame,
  -- which is the whole reason fame_min could not express this.
  SELECT array_agg(name) INTO v_names
  FROM pick_random_cards(
    '{"categories":["ZZTESTPOOLCAT"],"lang":"ko","lang_pool":1}'::jsonb, 10);
  ASSERT v_names = ARRAY['ZZTESTPOOL Знает Корея'],
    'ko pool of 1 must keep the card known in Korean, got: '
      || COALESCE(array_to_string(v_names, ' | '), '<null>');

  -- The same deck read in Russian keeps the other one. Same data, same
  -- pool size, different player — that is the feature.
  SELECT array_agg(name) INTO v_names
  FROM pick_random_cards(
    '{"categories":["ZZTESTPOOLCAT"],"lang":"ru","lang_pool":1}'::jsonb, 10);
  ASSERT v_names = ARRAY['ZZTESTPOOL Знает Россия'],
    'ru pool of 1 must keep the card known in Russian, got: '
      || COALESCE(array_to_string(v_names, ' | '), '<null>');

  -- Without a pool the deal is uniform over both, so BOTH must be reachable:
  -- the pool must not have quietly become a permanent ranking.
  ASSERT (SELECT count(*) FROM pick_random_cards(
            '{"categories":["ZZTESTPOOLCAT"],"lang":"ko"}'::jsonb, 10)) = 2,
    'without a pool the whole category must still be dealt';

  -- ── On "the hand stays random inside the pool" ─────────────────────
  -- Deliberately NOT asserted here, and the reason is a trap worth writing
  -- down rather than rediscovering. pick_random_cards is declared STABLE
  -- (deck_rpc.sql) while its body ends in ORDER BY random(), so within ONE
  -- statement Postgres may evaluate it once and reuse the result: a loop
  -- like `SELECT (SELECT name FROM pick_random_cards(...)) FROM
  -- generate_series(1,40)` returns the SAME card forty times and "proves"
  -- the deal is fixed. It is not — each RPC call is its own statement.
  --
  -- The randomness itself is inherited from that pre-existing ORDER BY,
  -- which this migration does not touch; the pool only adds a LIMIT above
  -- it. Asserting it here would test the planner, not the feature.
  --
  -- What IS asserted above and does cover the risk: the pool holds the top
  -- of the player's language (the two fixtures), and a hand bigger than the
  -- pool returns the whole pool rather than one repeated card.

  RAISE NOTICE 'deck_lang_pool: all assertions passed';
END
$test$;

SELECT 'deck_lang_pool: all assertions passed' AS result;

ROLLBACK;
