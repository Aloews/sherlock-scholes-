-- Famous players missing from the deck (checked by canonical_key against 3315 cards).
-- 13 new players. Idempotent: each row inserts only if no card with that name exists yet.
-- After running: backfill the rest with the usual scripts (photo_url, facts, clubs_minutes, tier, continent).

-- Молодые звёзды сборных (ЧМ-2026) (13)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Луис Гильерме', 'Luis Guilherme', 'player', 'игроки', ARRAY['Луис Гильерме','Луис','Гильерме']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Луис Гильерме'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Уэсли Франса', 'Wesley França', 'player', 'игроки', ARRAY['Уэсли Франса','Уэсли','Франса']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Уэсли Франса'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Фермин Лопес', 'Fermín López', 'player', 'игроки', ARRAY['Фермин Лопес','Фермин','Лопес']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Фермин Лопес'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Марк Берналь', 'Marc Bernal', 'player', 'игроки', ARRAY['Марк Берналь','Марк','Берналь']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Марк Берналь'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Браян Груда', 'Brajan Gruda', 'player', 'игроки', ARRAY['Браян Груда','Браян','Груда']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Браян Груда'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Ассан Уэдраого', 'Assan Ouédraogo', 'player', 'игроки', ARRAY['Ассан Уэдраого','Ассан','Уэдраого']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Ассан Уэдраого'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Гонсалу Инасиу', 'Gonçalo Inácio', 'player', 'игроки', ARRAY['Гонсалу Инасиу','Гонсалу','Инасиу']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Гонсалу Инасиу'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Франсишку Консейсан', 'Francisco Conceição', 'player', 'игроки', ARRAY['Франсишку Консейсан','Франсишку','Консейсан']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Франсишку Консейсан'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Родригу Мора', 'Rodrigo Mora', 'player', 'игроки', ARRAY['Родригу Мора','Родригу','Мора']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Родригу Мора'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Чезаре Казадеи', 'Cesare Casadei', 'player', 'игроки', ARRAY['Чезаре Казадеи','Чезаре','Казадеи']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Чезаре Казадеи'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Джан Узун', 'Can Uzun', 'player', 'игроки', ARRAY['Джан Узун','Джан','Узун']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Джан Узун'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Кендри Паэс', 'Kendry Páez', 'player', 'игроки', ARRAY['Кендри Паэс','Кендри','Паэс']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Кендри Паэс'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Рикардо Пепи', 'Ricardo Pepi', 'player', 'игроки', ARRAY['Рикардо Пепи','Рикардо','Пепи']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Рикардо Пепи'));

NOTIFY pgrst, 'reload schema';
