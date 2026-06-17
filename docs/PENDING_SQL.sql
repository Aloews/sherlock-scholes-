-- ============================================================================
-- PENDING_SQL — единая очередь SQL для Supabase (прод)
--
-- КАК ПОЛЬЗОВАТЬСЯ:
--   * Заходишь в Supabase SQL Editor и выполняешь ВЕСЬ файл целиком.
--   * Все блоки идемпотентны и САМОДОСТАТОЧНЫ (ничего не предполагают про прод)
--     — повторный прогон безопасен.
--   * Порядок важен: сверху вниз. Новое дописывается В КОНЕЦ датированной секцией.
--
-- ЖУРНАЛ:
--   2026-06-16  [CRITICAL] Восстановить pick_random_cards (без зависимостей)
--   2026-06-16  Добавить 22 известных игрока, которых не было в колоде
--   2026-06-16  Добавить 13 молодых звёзд сборных (ЧМ-2026), которых не было
-- ============================================================================


-- ============================================================================
-- 2026-06-16 — [CRITICAL] восстановить загрузку карточек
--
-- ПОЧЕМУ СЛОМАЛОСЬ: предыдущая версия pick_random_cards вызывала функцию
-- pro_only_tags() / tg_is_pro(), которых на проде НЕТ (миграция pro_deck.sql не
-- накатывалась). CREATE FUNCTION в Postgres не проверяет вызываемые функции —
-- поэтому показывал "Success", но при вызове из игры функция падала с
-- "function pro_only_tags() does not exist" -> карточки не грузились.
--
-- РЕШЕНИЕ: пересоздаём pick_random_cards БЕЗ внешних зависимостей. Поведение для
-- игроков идентично рабочему: фильтры по категориям / континентам / тегам.
-- Pro-теги остаются скрыты замком в UI (серверной проверки Pro и так не было).
-- p_init_data и p_difficulty приняты в сигнатуре для совместимости, но не
-- требуют никаких отсутствующих функций.
-- ============================================================================

-- Сносим ВСЕ возможные overload'ы, чтобы осталась ровно одна функция
-- (два overload'а -> неоднозначный вызов -> PGRST203).
drop function if exists pick_random_cards(int, text[], bigint);
drop function if exists pick_random_cards(int, text[], bigint, text[]);
drop function if exists pick_random_cards(int, text[], bigint, text[], text[]);
drop function if exists pick_random_cards(int, text[], bigint, text[], text[], text);
drop function if exists pick_random_cards(int, text[], bigint, text[], text[], text, int);

create function pick_random_cards(
  p_count         int,
  p_categories    text[]  default null,
  p_min_pageviews bigint  default null,
  p_continents    text[]  default null,
  p_tags          text[]  default null,
  p_init_data     text    default null,  -- принят для совместимости; не используется
  p_difficulty    int     default null   -- принят для совместимости; не используется
)
returns setof cards
language sql
stable
as $$
  select *
  from cards
  where active = true
    and (
      p_categories is null
      or cardinality(p_categories) = 0
      or category = any(p_categories)
    )
    and (
      p_min_pageviews is null
      or pageviews is null
      or pageviews > p_min_pageviews
    )
    and (
      p_continents is null
      or cardinality(p_continents) = 0
      or category <> 'player'
      or continent = any(p_continents)
      or (continent is null and 'other' = any(p_continents))
    )
    and (
      p_tags is null
      or cardinality(p_tags) = 0
      or tags && p_tags
    )
  order by random()
  limit p_count;
$$;

-- Перечитать схему PostgREST.
notify pgrst, 'reload schema';

-- Проверка (выполни ОТДЕЛЬНЫМ запросом после прогона) — должно вернуть числа,
-- без ошибок: function_exists = 1, active_cards = сотни, rpc_returns = 5.
--   select
--     (select count(*) from pg_proc where proname = 'pick_random_cards') as function_exists,
--     (select count(*) from cards where active = true)                   as active_cards,
--     (select count(*) from pick_random_cards(5))                        as rpc_returns;

-- ============================================================================
-- КОНЕЦ. Новые SQL дописываются НИЖЕ новой датированной секцией.
--
-- ОТЛОЖЕНО (НЕ выполнять, пока не проверим зависимости на проде):
--   * Pro-логика в pick_random_cards (требует pro_deck.sql: pro_only_tags,
--     tg_is_pro -> tg_validate_init_data -> users + секрет в Vault).
--   * Онбординг (games_played, get_user_status+games_played, bump_games,
--     p_difficulty-фильтр) — фронт онбординга пока не задеплоен, поэтому
--     серверная часть прямо сейчас не нужна.
-- Прежде чем их добавлять — прогоним диагностику что реально есть на проде.
-- ============================================================================


-- ============================================================================
-- 2026-06-16 — добавить известных игроков, которых не хватало в колоде
--
-- Найдено скриптом docs/cards_missing_famous_build.py (read-only сверка 95
-- известных игроков с 3290 карточками по canonical_key): 73 уже были, 22 — нет.
-- Имена (RU) взяты из ruwiki-сайтлинков Wikidata (не транслитерация).
-- Вставка МИНИМАЛЬНАЯ (name/name_en); остальное (фото, факты, минуты, tier,
-- континент) дозальёт обычный пайплайн бэкфилла. Идемпотентно (WHERE NOT
-- EXISTS), wc2026-тег навесит cards_wc2026_build.py отдельно.
-- ============================================================================

-- Вне топ-5 лиг (Saudi / MLS / др.) (5)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Рубен Невеш', 'Rúben Neves', 'player', 'игроки', ARRAY['Рубен Невеш','Рубен','Невеш']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Рубен Невеш'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Салим аль-Давсари', 'Salem Al-Dawsari', 'player', 'игроки', ARRAY['Салим аль-Давсари','Салим','аль-Давсари']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Салим аль-Давсари'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Луис Альберто Суарес', 'Luis Suárez', 'player', 'игроки', ARRAY['Луис Альберто Суарес','Луис','Альберто','Суарес']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Луис Альберто Суарес'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Дени Буанга', 'Denis Bouanga', 'player', 'игроки', ARRAY['Дени Буанга','Дени','Буанга']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Дени Буанга'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Талиска', 'Anderson Talisca', 'player', 'игроки', ARRAY['Талиска']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Талиска'));

-- Свежие звёзды 2025/26 (молодые/прорыв) (9)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Жуан Невеш', 'João Neves', 'player', 'игроки', ARRAY['Жуан Невеш','Жуан','Невеш']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Жуан Невеш'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Эндрик Фелипе', 'Endrick', 'player', 'игроки', ARRAY['Эндрик Фелипе','Эндрик','Фелипе']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Эндрик Фелипе'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Эстеван Виллиан', 'Estêvão', 'player', 'игроки', ARRAY['Эстеван Виллиан','Эстеван','Виллиан']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Эстеван Виллиан'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Жеовани Кенда', 'Geovany Quenda', 'player', 'игроки', ARRAY['Жеовани Кенда','Жеовани','Кенда']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Жеовани Кенда'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Франко Мастантуоно', 'Franco Mastantuono', 'player', 'игроки', ARRAY['Франко Мастантуоно','Франко','Мастантуоно']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Франко Мастантуоно'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Антонио Нуса', 'Antonio Nusa', 'player', 'игроки', ARRAY['Антонио Нуса','Антонио','Нуса']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Антонио Нуса'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Леннарт Карль', 'Lennart Karl', 'player', 'игроки', ARRAY['Леннарт Карль','Леннарт','Карль']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Леннарт Карль'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Майлз Льюис-Скелли', 'Myles Lewis-Skelly', 'player', 'игроки', ARRAY['Майлз Льюис-Скелли','Майлз','Льюис-Скелли']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Майлз Льюис-Скелли'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Ардон Яшари', 'Ardon Jashari', 'player', 'игроки', ARRAY['Ардон Яшари','Ардон','Яшари']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Ардон Яшари'));

-- Обладатели/номинанты Ballon d'Or & The Best (3)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Христо Стоичков', 'Hristo Stoichkov', 'player', 'игроки', ARRAY['Христо Стоичков','Христо','Стоичков']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Христо Стоичков'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Маттиас Заммер', 'Matthias Sammer', 'player', 'игроки', ARRAY['Маттиас Заммер','Маттиас','Заммер']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Маттиас Заммер'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Жан-Марк Босман', 'Jean-Marc Bosman', 'player', 'игроки', ARRAY['Жан-Марк Босман','Жан-Марк','Босман']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Жан-Марк Босман'));

-- Легенды прошлого (5)
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Жюст Фонтен', 'Just Fontaine', 'player', 'игроки', ARRAY['Жюст Фонтен','Жюст','Фонтен']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Жюст Фонтен'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Хидэтоси Наката', 'Hidetoshi Nakata', 'player', 'игроки', ARRAY['Хидэтоси Наката','Хидэтоси','Наката']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Хидэтоси Наката'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Хон Мён Бо', 'Hong Myung-bo', 'player', 'игроки', ARRAY['Хон Мён Бо','Хон','Мён','Бо']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Хон Мён Бо'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Самюэль Это’о', 'Samuel Eto''o', 'player', 'игроки', ARRAY['Самюэль Это’о','Самюэль','Это’о']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Самюэль Это’о'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Карлос Вальдеррама', 'Carlos Valderrama', 'player', 'игроки', ARRAY['Карлос Вальдеррама','Карлос','Вальдеррама']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Карлос Вальдеррама'));

NOTIFY pgrst, 'reload schema';
-- ============================================================================


-- ============================================================================
-- 2026-06-16 — добавить молодых звёзд сборных (ЧМ-2026), которых не хватало
--
-- Найдено docs/cards_missing_famous_build.py (расширенный список): из ~37
-- молодых международников 24 уже были в колоде, 13 — нет. Имена (RU) — из
-- ruwiki-сайтлинков Wikidata. Вставка минимальная; остальное дольёт бэкфилл
-- (docs/cards_enrich_newcomers.py). Идемпотентно.
-- ============================================================================

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
-- ============================================================================


-- ============================================================
-- 2026-06-16 — [newcomers] cards_star_backfill (после tier; новичкам нужен tier из бэкфилла)
-- Источник: docs/cards_star_backfill.sql. Глобальный идемпотентный
-- UPDATE (ставит 'star' только где его нет). Безопасно повторять.
-- ============================================================
-- ============================================================
-- SHERLOCK SCHOLES — backfill the composite 'star' tag
--
-- The quick-game preset "Звёзды" filters cards.tags && ['star'], but the
-- 'star' tag was never populated (the composite-fame threshold was deferred),
-- so the preset returned 0 cards. This loads it.
--
-- star := high pageviews OR has a title OR tier legendary/epic.
-- "Played at WC/Euro" is deliberately EXCLUDED: it matched ~1156 players and
-- bloated stars to ~50% — playing at a World Cup ≠ a star. Without it the set
-- is the genuinely well-known players. (No sitelinks signal — not collected.)
-- Idempotent: re-running adds 'star' only where missing. Projected: ~345 of
-- 2600 active player cards.
-- Run in the Supabase SQL Editor.
-- ============================================================

update cards c
set tags = (
  select array(
    select distinct e
    from unnest(coalesce(c.tags, '{}'::text[]) || array['star']) e
  )
)
where c.category = 'player'
  and c.active = true
  and not ('star' = any(coalesce(c.tags, '{}'::text[])))
  and (
        coalesce(c.pageviews, 0) >= 19000
        or (jsonb_typeof(c.facts->'titles') = 'array'
            and jsonb_array_length(c.facts->'titles') > 0)
        or (jsonb_typeof(c.legend_career->'titles') = 'array'
            and jsonb_array_length(c.legend_career->'titles') > 0)
        or c.tier in ('legendary', 'epic')
      );

-- VERIFY — how many stars now:
--   select count(*) from cards
--   where active and category='player' and 'star' = any(tags);


-- ============================================================================
-- 2026-06-16 — [fix] обнулить битые career_stats с вики-разметкой
--
-- ПОЧЕМУ: старый clean_club() в docs/cards_career_build.py не вырезал сноски
-- <ref>{{Cite web…}}</ref> и шаблоны {{...}}, поэтому в career_stats уехал
-- мусор вида 'Sacrofano<ref>{{Cite web…}}</ref>' (видно на карточке Гарринчи).
-- clean_club() починен (strip_markup убирает <ref>, вложенные {{...}}, <теги>),
-- но career_build НЕ перезапишет уже залитые строки (guard career_stats IS NULL).
-- Поэтому ОБНУЛЯЕМ битые строки — затем перезаливаем из football_scraper/:
--     APPLY=1 python ../docs/cards_career_build.py
-- Идемпотентно: повторный прогон ничего не тронет, когда мусора уже нет.
-- ============================================================================

update cards
set career_stats = null
where career_stats::text like '%<ref%'
   or career_stats::text like '%{{%';

-- VERIFY — должно вернуть 0 после перезаливки career_build:
--   select count(*) from cards
--   where career_stats::text like '%<ref%' or career_stats::text like '%{{%';
-- ============================================================================
