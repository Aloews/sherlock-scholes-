-- ============================================================
-- SHERLOCK SCHOLES — Migration: card_translations
-- Card-name translations (es/pt/fr/zh/ja/ko/ar) for the deck.
-- Run in the Supabase SQL Editor.
--
-- NOTE: a table named card_translations ALREADY EXISTS in this DB
-- (probes return 42501 — created earlier, no grants). If its shape
-- differs from the one below, uncomment the DROP line first.
-- CREATE TABLE IF NOT EXISTS keeps an existing correct table as is.
-- ============================================================

-- DROP TABLE IF EXISTS card_translations;  -- only if the old shape is wrong

CREATE TABLE IF NOT EXISTS card_translations (
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  lang    TEXT NOT NULL,            -- 'es' | 'pt' | 'fr' | 'zh' | 'ja' | 'ko' | 'ar'
  name    TEXT NOT NULL,            -- display name in that language
  source  TEXT,                     -- 'sitelink' | 'label' | 'name_en' (latin copy)
  PRIMARY KEY (card_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_card_translations_lang
  ON card_translations(lang);

-- RLS: the frontend only READS translations; all writes come from the
-- scraper with the service_role key (same model as rls_lockdown.sql).
ALTER TABLE card_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "card_translations_public_select" ON card_translations;
CREATE POLICY "card_translations_public_select" ON card_translations
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON card_translations TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON card_translations FROM anon, authenticated;

-- service_role bypasses RLS but still needs table-level privileges
-- (same lesson as grant_scraper_service_role.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON card_translations TO service_role;

-- The frontend embeds translations via cards?select=*,card_translations(*)
-- (FK card_id -> cards.id makes the relationship visible to PostgREST).
NOTIFY pgrst, 'reload schema';
