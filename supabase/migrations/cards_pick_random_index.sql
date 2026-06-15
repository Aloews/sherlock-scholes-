-- ============================================================
-- SHERLOCK SCHOLES — Migration: pick_random_cards scan index
-- Run manually in the Supabase SQL Editor.
--
-- WHY (not what you might expect):
--   Measured on prod with the full deck (~3260 rows), a WARM
--   pick_random_cards responds in ~600-850 ms. That time is network
--   round-trip + connection pool, NOT the query: ORDER BY random()
--   over ~3k rows is a top-N heapsort that costs single-digit ms
--   server-side. The "cards don't load at all" reports are free-tier
--   cold start (handled client-side: backoff retry + warm-up ping).
--
--   So the RPC BODY and SIGNATURE are unchanged — there is nothing to
--   optimize in the query at today's size. This migration only adds a
--   partial index so the active+category filter keeps using an index
--   scan (instead of a growing seq scan) as the deck expands. It is a
--   "future-proofing" change, safe to run now, no downtime.
--
--   TABLESAMPLE was deliberately NOT used: it samples disk blocks
--   before the WHERE/category filter runs, so a narrow category
--   selection could return fewer than p_count rows and skew per-
--   category fairness. Wrong trade-off for a small table.
-- ============================================================

-- Active rows, indexed by category — covers the hot filter in
-- pick_random_cards (active = TRUE AND category = ANY(...)) and the
-- countDeck head requests. continent already has idx_cards_continent.
CREATE INDEX IF NOT EXISTS idx_cards_active_category
  ON cards(category) WHERE active = TRUE;

ANALYZE cards;
