-- ============================================================
-- SHERLOCK SCHOLES — speed up the admin card search.
--
-- The admin editor searches cards by `name`/`name_en` with a
-- double-sided ILIKE ('%query%'). On a 3000+ row deck a plain
-- ILIKE is a sequential scan (slow, especially on a cold free-tier
-- DB). pg_trgm + a GIN trigram index makes substring ILIKE use the
-- index instead, cutting search latency dramatically.
--
-- Idempotent: extension + index both guarded by IF NOT EXISTS.
-- Run in the Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cards_name_trgm
  ON cards USING gin (name gin_trgm_ops, name_en gin_trgm_ops);

NOTIFY pgrst, 'reload schema';
