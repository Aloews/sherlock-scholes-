-- ============================================================
-- SHERLOCK SCHOLES — Migration: photo_url (players_meta + cards)
-- Player photo from Wikidata P18, served via Wikimedia Commons
-- Special:FilePath with ?width=256 (legal hotlink, auto-thumbnail).
--   players_meta.photo_url — filled by `run.py --photos`
--   cards.photo_url        — copied by `run.py --to-cards` for new
--                            cards; existing cards are backfilled by
--                            docs/cards_fill_photo_url_preview.py
-- NULL when the player has no P18 image; the game must treat NULL
-- as "no photo" and render the card as today, so nothing breaks.
-- Run manually in the Supabase SQL Editor. Idempotent.
--
-- NOTE: pick_random_cards() RETURNS SETOF cards, so cards.photo_url
-- flows through the RPC automatically — no function change needed.
-- Run this BEFORE `run.py --photos` and before the next
-- `run.py --to-cards`, otherwise those writes fail (PGRST204).
-- ============================================================

ALTER TABLE players_meta ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE cards        ADD COLUMN IF NOT EXISTS photo_url TEXT;
