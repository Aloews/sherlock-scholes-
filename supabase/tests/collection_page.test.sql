-- ============================================================
-- SHERLOCK SCHOLES — test: collection_views() / collection_page()
--
-- Covers supabase/migrations/collection_page_by_lang.sql — the Collection
-- ordering by the VIEWER's language instead of ru-wiki views.
--
-- The two assertions that carry the whole migration:
--
--   Case 1 (GREATEST trap). «Зенит» has a big Russian score and a small
--   French one. The obvious `greatest(lang_views, pageviews)` returns the
--   Russian number for a French viewer, so the card stays on top and the
--   original complaint is untouched. Asserting the French order here is what
--   stops that sketch from being reintroduced as a "simplification".
--
--   Case 5 (TEXT-sort trap). PostgREST orders `pageviews_i18n->>'fr'` as
--   text, where "9" > "10000". A card with 9 views must NOT outrank one with
--   10000 — this is why the ordering lives in SQL with a bigint cast at all.
--
-- The rest pin the fallback ladder, which is where a well-meaning edit does
-- quiet damage: reading zero for a card whose language was never collected
-- would bury half the deck, and reading the Russian score for a card that IS
-- collected but has no article in this language would un-fix the bug.
--
-- HOW TO RUN — Supabase SQL Editor, or:
--     psql "$DATABASE_URL" -f supabase/tests/collection_page.test.sql
--
-- SAFETY. One transaction ending in ROLLBACK: the fixture cards never
-- survive it. Fixtures are named with a 'ZZTESTCOL' prefix and every
-- assertion is scoped to that prefix via p_query, so the result never
-- depends on what the real deck happens to hold.
--
-- Requires: collection_page_by_lang.sql.
-- On success prints one row: `collection_page: all assertions passed`.
-- On failure the transaction aborts with the failing ASSERT message.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_names TEXT[];
BEGIN
  -- ---------------------------------------------------------------
  -- collection_views(): the fallback ladder, asserted directly.
  -- ---------------------------------------------------------------

  -- 1. The viewer's language wins over the Russian column, even when the
  --    Russian number is far bigger. GREATEST would return 523129 here.
  ASSERT collection_views(523129, '{"ru":445343,"fr":2100}'::jsonb, 'fr') = 2100,
    'fr viewer must read the fr key, not the bigger ru score';

  -- 2. ru viewer, legacy vector with no 'ru' key (every card filled before ru
  --    joined LANGS): falls back to cards.pageviews rather than reading 0.
  ASSERT collection_views(523129, '{"en":313560}'::jsonb, 'ru') = 523129,
    'ru viewer must fall back to cards.pageviews when the vector has no ru key';

  -- 3. ru viewer, vector WITH a ru key: the key wins — that key is the
  --    correctly-resolved article, cards.pageviews may be off a namesake.
  ASSERT collection_views(523129, '{"ru":445343}'::jsonb, 'ru') = 445343,
    'ru viewer must prefer the collected ru key over cards.pageviews';

  -- 4. Card never processed at all scores 0 for a FOREIGN language — it does
  --    NOT borrow its Russian count. Mixing the two scales put «Брест» (a
  --    Belarusian city's ru views) above Tottenham's real Korean views at the
  --    top of the Korean «Клубы» tab. The Russian order survives as the
  --    caller's SECOND sort key, asserted further down.
  ASSERT collection_views(255299, NULL, 'ko') = 0,
    'no language data must not lend a Russian score to a Korean viewer';
  ASSERT collection_views(255299, '{}'::jsonb, 'fr') = 0,
    'an empty vector must not lend a Russian score either';
  -- …but a ru viewer still reads that very column.
  ASSERT collection_views(255299, NULL, 'ru') = 255299,
    'a ru viewer reads cards.pageviews even with no vector';

  -- 5. Processed, but no article in this language -> 0, NOT the Russian
  --    score. This is the line that keeps a Russian-only club out of a
  --    French player''s first screen.
  ASSERT collection_views(523129, '{"ru":445343,"en":313560}'::jsonb, 'fr') = 0,
    'a collected card with no article in this language must score 0';

  -- 6. A non-numeric value must not abort the page with a cast error.
  ASSERT collection_views(500, '{"fr":"n/a"}'::jsonb, 'fr') = 0,
    'junk in the vector must degrade to 0, not raise';

  -- 7. Nothing anywhere is still an integer, never NULL — a NULL sort key
  --    would scatter such cards through the page instead of at the end.
  ASSERT collection_views(NULL, '{"en":10}'::jsonb, 'fr') = 0,
    'no data in any form must be 0, not NULL';

  -- ---------------------------------------------------------------
  -- collection_page(): the ordering the screen actually gets.
  -- ---------------------------------------------------------------
  INSERT INTO cards (name, name_en, category, active, pageviews, pageviews_i18n) VALUES
    -- Russian giant, small abroad: the «Зенит» shape.
    ('ZZTESTCOL Зенит',  'ZZTESTCOL Zenit',  'club', true, 523129,
       '{"ru":445343,"fr":2100}'::jsonb),
    -- Modest at home, big in France.
    ('ZZTESTCOL Ланс',   'ZZTESTCOL Lens',   'club', true,  40000,
       '{"ru":40000,"fr":190000}'::jsonb),
    -- The text-sort trap: 9 must not outrank 10000.
    ('ZZTESTCOL Девять', 'ZZTESTCOL Nine',   'club', true,      0,
       '{"fr":9}'::jsonb),
    ('ZZTESTCOL Десять', 'ZZTESTCOL TenK',   'club', true,      0,
       '{"fr":10000}'::jsonb),
    -- The «Брест» shape: no language data at all, and a huge Russian score
    -- that is not even this card's subject. Must sit in the TAIL for fr,
    -- behind every card with a real French measurement — including the one
    -- whose French count is 9.
    ('ZZTESTCOL Брест',  'ZZTESTCOL Brest',  'club', true, 255299, NULL),
    -- Tail-mate with a smaller Russian score, to prove the tail is ordered
    -- by pageviews and not by name.
    ('ZZTESTCOL Абвгд',  'ZZTESTCOL Abcde',  'club', true,   1000, NULL);

  SELECT array_agg(name ORDER BY ord) INTO v_names
  FROM (
    SELECT name, row_number() OVER () AS ord
    FROM collection_page('fr', 'club', 'ZZTESTCOL', 50, 0)
  ) s;

  -- Measured-in-French first (190000 > 10000 > 2100 > 9), then the tail we
  -- cannot measure in French, in Russian order (255299 > 1000).
  ASSERT v_names = ARRAY['ZZTESTCOL Ланс', 'ZZTESTCOL Десять',
                         'ZZTESTCOL Зенит', 'ZZTESTCOL Девять',
                         'ZZTESTCOL Брест', 'ZZTESTCOL Абвгд'],
    'fr order wrong, got: ' || COALESCE(array_to_string(v_names, ' | '), '<null>');

  -- The regression itself, stated as its own assertion: a card with no
  -- language data must never outrank a real measurement, however small.
  ASSERT array_position(v_names, 'ZZTESTCOL Брест')
         > array_position(v_names, 'ZZTESTCOL Девять'),
    'a card with no language data outranked a real French count — the '
    'scale-mixing bug is back';

  -- The same four cards for a Russian viewer: «Зенит» is genuinely first
  -- here, which is the point — the fix is not "demote Зенит", it is "rank by
  -- the language being read".
  SELECT array_agg(name ORDER BY ord) INTO v_names
  FROM (
    SELECT name, row_number() OVER () AS ord
    FROM collection_page('ru', 'club', 'ZZTESTCOL', 50, 0)
  ) s;

  ASSERT v_names[1] = 'ZZTESTCOL Зенит',
    'ru viewer must still see the Russian favourite first, got: '
      || COALESCE(v_names[1], '<null>');

  -- Regional tags ('pt-BR', 'fr-CA') must resolve to the base language, not
  -- fall through to 0 for everyone.
  SELECT array_agg(name ORDER BY ord) INTO v_names
  FROM (
    SELECT name, row_number() OVER () AS ord
    FROM collection_page('fr-CA', 'club', 'ZZTESTCOL', 50, 0)
  ) s;

  ASSERT v_names[1] = 'ZZTESTCOL Ланс',
    'a regional tag must resolve to its base language, got: '
      || COALESCE(v_names[1], '<null>');

  -- Paging is stable: page 2 continues page 1, never repeats it. Cards that
  -- tie at 0 in a language are the ones that would otherwise shuffle.
  SELECT array_agg(name ORDER BY ord) INTO v_names
  FROM (
    SELECT name, row_number() OVER () AS ord
    FROM collection_page('fr', 'club', 'ZZTESTCOL', 2, 2)
  ) s;

  ASSERT v_names = ARRAY['ZZTESTCOL Зенит', 'ZZTESTCOL Девять'],
    'offset paging must continue the same order, got: '
      || COALESCE(array_to_string(v_names, ' | '), '<null>');

  -- The search term is a bind parameter now, so PostgREST filter syntax in
  -- the box is just text. It must match literally and never widen the result.
  ASSERT (SELECT count(*) FROM collection_page('fr', NULL, 'ZZTESTCOL Зенит', 50, 0)) = 1,
    'a search term must match literally';
  ASSERT (SELECT count(*) FROM collection_page('fr', NULL, 'ZZTESTCOL,()', 50, 0)) = 0,
    'PostgREST filter punctuation must not widen the search';

  RAISE NOTICE 'collection_page: all assertions passed';
END
$test$;

SELECT 'collection_page: all assertions passed' AS result;

ROLLBACK;
