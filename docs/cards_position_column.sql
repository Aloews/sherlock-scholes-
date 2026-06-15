-- ============================================================
-- SHERLOCK SCHOLES — cards.position_ru (player position, Russian)
-- One of: Вратарь / Защитник / Полузащитник / Нападающий.
-- Backfilled by --cards-position from the API-Football cache
-- (games.position) with a Wikidata P413 fallback for legends.
-- Shown in the summary history line "флаг страна · позиция".
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS position_ru TEXT;

NOTIFY pgrst, 'reload schema';
