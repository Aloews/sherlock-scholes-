-- Collection screen: index for the catalog browse query.
--
-- APPLIED to the production project (konoavrduynecxblqfvq) via the Supabase
-- MCP as migration `cards_collection_browse_index`. Kept here so the repo
-- stays the record of schema changes; re-running is a no-op.
--
-- src/features/collection/collectionApi.ts runs, per page:
--   select … from cards
--   where active = true [and category = …] [and (name ilike … or name_en ilike …)]
--   order by pageviews desc nulls last, name
--   limit 48 offset …
--
-- Measured on production before applying (3364 active rows of 3414):
--   seq scan + top-N heapsort, 36 ms
-- After:
--   index scan, 0.35 ms
--
-- Worth being precise about what this did and did not fix: 36 ms was never
-- the reason the screen felt slow — the database was not the bottleneck. This
-- is a preventive win that keeps the query flat as the deck grows, not a cure
-- for perceived load time.
--
-- `name` is the tiebreaker the API adds so paging stays stable across
-- requests; it has to be in the index in the same order to be usable.
create index if not exists cards_active_browse_idx
  on cards (pageviews desc nulls last, name)
  where active;

-- The category filter is a plain equality on top of the same sort.
create index if not exists cards_active_category_browse_idx
  on cards (category, pageviews desc nulls last, name)
  where active;

-- Note: the name search uses ilike '%term%', which no btree can serve. That
-- path is covered by idx_cards_name_trgm (cards_name_trgm.sql) — verified
-- present and in use on production: BitmapOr over the trigram index, 4.4 ms.

NOTIFY pgrst, 'reload schema';
