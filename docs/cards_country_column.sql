-- ============================================================
-- SHERLOCK SCHOLES — cards.country (ISO code for the player flag)
-- Adds the country column; --cards-country backfills it (ISO 3166-1
-- alpha-2; England/Scotland/Wales as GB-ENG/GB-SCT/GB-WLS) from the
-- API-Football nationality cache + Wikidata P27. The frontend turns
-- the code into an emoji flag badge on the history avatar.
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS country TEXT;

NOTIFY pgrst, 'reload schema';
