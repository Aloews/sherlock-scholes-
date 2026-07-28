-- Collection screen: index for the catalog browse query.
--
-- src/features/collection/collectionApi.ts runs, per page:
--   select … from cards
--   where active = true [and category = …] [and (name ilike … or name_en ilike …)]
--   order by pageviews desc nulls last, name
--   limit 48 offset …
--
-- Without a matching index Postgres filters, then sorts the entire matching
-- set on EVERY page — ~2.1k rows re-sorted per keystroke-debounced query. The
-- partial index below matches the sort exactly, so paging becomes an index
-- scan and the offset walk stays cheap.
--
-- `name` is the tiebreaker the API adds so paging is stable across requests;
-- it has to be in the index in the same order to be usable.
create index if not exists cards_active_browse_idx
  on cards (pageviews desc nulls last, name)
  where active;

-- The category filter is a plain equality on top of the same sort.
create index if not exists cards_active_category_browse_idx
  on cards (category, pageviews desc nulls last, name)
  where active;

-- Note: the name search uses ilike '%term%', which no btree can serve. The
-- trigram index from cards_name_trgm.sql is what covers that path — make sure
-- it has been applied, and that pg_trgm is enabled, before blaming this file
-- for slow searches.

NOTIFY pgrst, 'reload schema';
