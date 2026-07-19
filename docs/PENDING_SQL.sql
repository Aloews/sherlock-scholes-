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
--   2026-07-18  join_1v1_room — атомарный join для 1v1 [ПРИМЕНЕНО на проде]
--   2026-07-18  Оплата: initData-валидация + grant service_role [ПРИМЕНЕНО]
--   2026-07-18  REVOKE TRUNCATE у anon + онбординг (games_played, p_difficulty) [ПРИМЕНЕНО]
--   2026-07-18  Переводы (RLS-политика card_translations) + search_path + индексы [ПРИМЕНЕНО]
--   2026-07-18  Онбординг строже: wc2026 убран из исключений сложности [ПРИМЕНЕНО]
--   2026-07-19  Легенды/ballon_dor бэкфилл + колонка descriptions [ОЖИДАЕТ]
--   2026-07-19  Культурная локализация: буст стран, langs, 21 комментатор [ОЖИДАЕТ]
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


-- ============================================================================
-- 2026-07-18 — новые звёзды/прорывы ЧМ-2026 (8 карточек, bare newcomers)
--
-- ПОЧЕМУ: cards_wc2026_build.py только проставляет тег существующим карточкам,
-- новых игроков не создаёт. Это прорывные игроки турнира, которых ещё нет в
-- колоде. Вставляем минимально (name/name_en/forbidden_words/active) — дальше
-- ночной daily_enrich подхватит их шагом newcomers (resolve -> facts -> tier).
--
-- ИМЕНА СВЕРЕНЫ С ru.wikipedia (резолвер бьёт по каноническому ключу русского
-- name с порогом сходства 0.85; опечатка = карточка молча не обогатится).
-- Исправлено против исходного списка:
--   «Йохан Манзамби» -> «Жоан Манзамби»   (ru: Манзамби, Жоан)
--   «Ян Диоманде»    -> «Ян Дьоманде»     (ru: Дьоманде, Ян; есть др. Диоманде)
--   «Хулиан Кинонес» -> «Хулиан Киньонес» (ru: Киньонес, Хулиан)
-- Совпали как есть: Аюб Буадди, Ману Коне, Возинья, Педро Вите, Дениз Ундав.
-- (Педро Вите: в ru.wiki сейчас «Ванкувер Уайткэпс», не «Пумас» — на карточку
--  это не влияет, клуб не хранится, обогащение тянет актуальные данные.)
-- ============================================================================

INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Жоан Манзамби', 'Johan Manzambi', 'player', 'игроки', ARRAY['Жоан Манзамби','Жоан','Манзамби']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Жоан Манзамби'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Аюб Буадди', 'Ayyoub Bouaddi', 'player', 'игроки', ARRAY['Аюб Буадди','Аюб','Буадди']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Аюб Буадди'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Ян Дьоманде', 'Yan Diomandé', 'player', 'игроки', ARRAY['Ян Дьоманде','Ян','Дьоманде']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Ян Дьоманде'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Ману Коне', 'Manu Koné', 'player', 'игроки', ARRAY['Ману Коне','Ману','Коне']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Ману Коне'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Возинья', 'Vozinha', 'player', 'игроки', ARRAY['Возинья']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Возинья'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Педро Вите', 'Pedro Vite', 'player', 'игроки', ARRAY['Педро Вите','Педро','Вите']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Педро Вите'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Хулиан Киньонес', 'Julián Quiñones', 'player', 'игроки', ARRAY['Хулиан Киньонес','Хулиан','Киньонес']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Хулиан Киньонес'));
INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active)
SELECT 'Дениз Ундав', 'Deniz Undav', 'player', 'игроки', ARRAY['Дениз Ундав','Дениз','Ундав']::text[], true
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower('Дениз Ундав'));

-- VERIFY — 8 карточек существуют (после ручного прогона PENDING_SQL или ночного CI):
--   select name, name_en, facts is not null as enriched from cards
--   where name in ('Жоан Манзамби','Аюб Буадди','Ян Дьоманде','Ману Коне',
--                  'Возинья','Педро Вите','Хулиан Киньонес','Дениз Ундав')
--   order by name;
-- ============================================================================


-- ============================================================================
-- 2026-07-18 — join_1v1_room: атомарный join для 1v1 (гонка вместимости)
--
-- ПРОБЛЕМА: клиент делал check-then-insert (посчитать игроков → вставить).
-- Два одновременных join'а оба видят count = 1 < 2 → в комнате 3 игрока и
-- 3 команды. Плюс join мог проскочить одновременно со стартом игры хостом —
-- игрок «в комнате», но раунды уже созданы без него.
--
-- РЕШЕНИЕ: одна транзакция с блокировкой строки комнаты (FOR UPDATE):
-- статус, вместимость, создание команды и membership выполняются атомарно.
-- Клиент (roomService.joinRoom) сначала зовёт RPC и падает на старый
-- клиентский путь, только пока функции нет на проде.
-- Идемпотентно: CREATE OR REPLACE; повторный join того же игрока просто
-- возвращает комнату.
-- ============================================================================

CREATE OR REPLACE FUNCTION join_1v1_room(p_room_id UUID, p_player_id BIGINT)
RETURNS rooms AS $$
DECLARE
  v_room    rooms;
  v_count   INT;
  v_team_id UUID;
  v_name    TEXT;
BEGIN
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'waiting' OR v_room.mode <> '1v1' THEN
    RAISE EXCEPTION 'ROOM_NOT_WAITING';
  END IF;

  -- Повторный join того же игрока — уже внутри, ничего не меняем.
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = p_room_id AND player_id = p_player_id
  ) THEN
    RETURN v_room;
  END IF;

  SELECT count(*) INTO v_count FROM room_players WHERE room_id = p_room_id;
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'ROOM_FULL_1V1';
  END IF;

  SELECT first_name INTO v_name FROM players WHERE id = p_player_id;

  INSERT INTO teams (room_id, name, color)
  VALUES (p_room_id, coalesce(v_name, 'Player 2'), '#3b82f6')
  RETURNING id INTO v_team_id;

  INSERT INTO room_players (room_id, player_id, team_id)
  VALUES (p_room_id, p_player_id, v_team_id);

  RETURN v_room;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION join_1v1_room(UUID, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION join_1v1_room(UUID, BIGINT) TO authenticated;

-- VERIFY:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'join_1v1_room';


-- ============================================================================
-- 2026-07-18 — оплата: установить/проверить серверную валидацию initData
--
-- СИМПТОМ: кнопка «Купить Pro» сразу пишет «Не удалось открыть оплату».
-- Цепочка: фронт → edge-функция tg-pay (create_invoice) → RPC get_user_status
-- → tg_validate_init_data → HMAC-проверка initData по БОТ-ТОКЕНУ ИЗ VAULT.
-- Если на проде нет get_user_status / tg_validate_init_data / users, ИЛИ в
-- Vault нет секрета 'telegram_bot_token' (или там placeholder) — tg-pay
-- отвечает 401 invalid_init_data и фронт показывает эту ошибку. Настройка
-- setup_payment.py это НЕ покрывала: она ставила env-переменные функции и
-- вебхук, но не Vault-копию бот-токена, которой подписи проверяет БД.
--
-- ЧТО ДЕЛАЕТ БЛОК (идемпотентно, ничего не ломает):
--   1) ставит pgcrypto, создаёт таблицу users (если нет) с RLS без политик;
--   2) создаёт Vault-секрет 'telegram_bot_token' С PLACEHOLDER'ом, ТОЛЬКО
--      если секрета нет вовсе (существующий НЕ трогает);
--   3) пересоздаёт внутренние функции _tg_url_decode / tg_validate_init_data
--      (они стабильны, replace безопасен);
--   4) создаёт get_user_status ТОЛЬКО если её нет — существующую (возможно,
--      расширенную games_played) НЕ перезаписывает;
--   5) выдаёт гранты и перечитывает схему PostgREST.
--
-- ПОСЛЕ ПРОГОНА: выполни VERIFY внизу. Если bot_token_vault = 'PLACEHOLDER',
-- ОБЯЗАТЕЛЬНО поставь настоящий токен (тот же, что в TELEGRAM_BOT_TOKEN у
-- tg-pay):
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'telegram_bot_token'),
--     '123456:НАСТОЯЩИЙ_ТОКЕН_БОТА');
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists users (
  telegram_id bigint primary key,
  is_pro      boolean     not null default false,
  pro_since   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table users enable row level security;
revoke all on table users from anon, authenticated;

-- Vault: создать секрет только при полном отсутствии (не плодить дубликаты
-- и не затирать боевой токен).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'telegram_bot_token') then
    perform vault.create_secret('CHANGE_ME_BOT_TOKEN', 'telegram_bot_token');
  end if;
end $$;

-- Внутренние функции (полные копии из supabase/migrations/pro_users.sql).
create or replace function _tg_url_decode(p text)
returns text
language plpgsql
immutable
as $$
declare
  result bytea := '\x';
  s text := replace(p, '+', ' ');
  n int := length(s);
  i int := 1;
  c text;
begin
  while i <= n loop
    c := substr(s, i, 1);
    if c = '%' and i + 2 <= n then
      result := result || decode(substr(s, i + 1, 2), 'hex');
      i := i + 3;
    else
      result := result || convert_to(c, 'utf8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(result, 'utf8');
end;
$$;

create or replace function tg_validate_init_data(p_init_data text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_token   text;
  v_pair    text;
  v_eq      int;
  v_key     text;
  v_val     text;
  v_hash    text := null;
  v_auth    bigint := null;
  v_user    text := null;
  v_keys    text[] := '{}';
  v_vals    text[] := '{}';
  v_dcs     text;
  v_secret  bytea;
  v_calc    text;
  v_id      bigint;
begin
  if p_init_data is null or length(p_init_data) = 0 then
    return null;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'telegram_bot_token'
  limit 1;
  if v_token is null or v_token like 'CHANGE_ME%' then
    return null;  -- bot token not configured yet
  end if;

  foreach v_pair in array string_to_array(p_init_data, '&') loop
    v_eq := position('=' in v_pair);
    if v_eq = 0 then continue; end if;
    v_key := substr(v_pair, 1, v_eq - 1);
    v_val := substr(v_pair, v_eq + 1);
    if v_key = 'hash' then
      v_hash := lower(v_val);
    else
      v_keys := array_append(v_keys, v_key);
      v_vals := array_append(v_vals, _tg_url_decode(v_val));
      if v_key = 'auth_date' then
        v_auth := _tg_url_decode(v_val)::bigint;
      elsif v_key = 'user' then
        v_user := _tg_url_decode(v_val);
      end if;
    end if;
  end loop;

  if v_hash is null then return null; end if;

  select string_agg(line, e'\n' order by k)
  into v_dcs
  from (
    select v_keys[i] as k, v_keys[i] || '=' || v_vals[i] as line
    from generate_subscripts(v_keys, 1) as i
  ) t;

  v_secret := hmac(v_token, 'WebAppData', 'sha256');
  v_calc   := encode(hmac(convert_to(v_dcs, 'utf8'), v_secret, 'sha256'), 'hex');

  if v_calc <> v_hash then
    return null;
  end if;

  if v_auth is null or v_auth < extract(epoch from now())::bigint - 86400 then
    return null;
  end if;

  begin
    v_id := (v_user::jsonb ->> 'id')::bigint;
  exception when others then
    v_id := null;
  end;

  return v_id;
end;
$$;

-- get_user_status: создать только при отсутствии — расширенную прод-версию
-- (например, с games_played из pro_onboarding.sql) НЕ затирать.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_user_status') then
    execute $fn$
      create function get_user_status(p_init_data text)
      returns json
      language plpgsql
      security definer
      set search_path = public, vault, extensions
      as $body$
      declare
        v_id  bigint;
        v_row users;
      begin
        v_id := tg_validate_init_data(p_init_data);
        if v_id is null then
          raise exception 'invalid init data' using errcode = '28000';
        end if;

        insert into users (telegram_id) values (v_id)
        on conflict (telegram_id) do update set updated_at = now()
        returning * into v_row;

        return json_build_object(
          'telegram_id', v_row.telegram_id,
          'is_pro',      v_row.is_pro,
          'pro_since',   v_row.pro_since
        );
      end;
      $body$;
    $fn$;
  end if;
end $$;

revoke all on function _tg_url_decode(text)        from public;
revoke all on function tg_validate_init_data(text) from public;
grant execute on function get_user_status(text)    to anon, authenticated;
-- НАЙДЕННАЯ НА ПРОДЕ ПРИЧИНА 401 (2026-07-18): именно этого гранта не было.
-- service_role обходит RLS, но НЕ acl функций; pro_users.sql делал revoke from
-- public и грантовал только anon/authenticated — поэтому фронт работал, а
-- tg-pay (service key) получал "permission denied for function get_user_status".
grant execute on function get_user_status(text)    to service_role;

notify pgrst, 'reload schema';

-- VERIFY — все три должны быть > 0, а bot_token_vault = 'SET' (иначе см. шапку):
--   select
--     (select count(*) from pg_proc where proname = 'get_user_status')       as rpc_exists,
--     (select count(*) from pg_proc where proname = 'tg_validate_init_data') as validator_exists,
--     (select count(*) from pg_tables where tablename = 'users')             as users_table,
--     (select case
--        when decrypted_secret is null           then 'MISSING'
--        when decrypted_secret like 'CHANGE_ME%' then 'PLACEHOLDER'
--        else 'SET' end
--      from vault.decrypted_secrets where name = 'telegram_bot_token')       as bot_token_vault;
-- ============================================================================


-- ============================================================================
-- 2026-07-18 — защита данных + онбординг [ПРИМЕНЕНО на проде через MCP]
--
-- 1) REVOKE TRUNCATE/TRIGGER/REFERENCES у anon/authenticated на всех таблицах.
--    TRUNCATE не подчиняется RLS, и дефолтные гранты позволяли ЛЮБОМУ с
--    публичным anon-ключом (он в бандле фронта) очистить cards/rooms/scores
--    одним запросом. rls_lockdown.sql отзывал только INSERT/UPDATE/DELETE.
--    Приложение эти привилегии не использует — отзыв ничего не ломает.
--
-- 2) get_user_status теперь возвращает games_played (версия pro_onboarding) —
--    фронт читает стартовый счётчик онбординга без лишнего round-trip.
--    Гранты: anon, authenticated, service_role (tg-pay!).
--
-- 3) pick_random_cards: p_difficulty теперь РЕАЛЬНО фильтрует (пол по
--    pageviews; tier legendary/epic и wc2026 проходят всегда). Раньше параметр
--    принимался и игнорировался — онбординг-сложность не работала. Версия БЕЗ
--    зависимостей pro_deck (tg_is_pro/pro_only_tags на проде нет; их вызов из
--    этой функции однажды уже ронял колоду). Сигнатура 7-арг сохранена.
--
-- ПРОВЕРЕНО после наката: полная колода 1000/1000, лёгкий пул (floor 25000)
-- 806 карточек, теги/континенты работают, service_role сохранил EXECUTE.
-- Идемпотентно — повторный прогон безопасен.
-- ============================================================================

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

create or replace function get_user_status(p_init_data text)
returns json
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id  bigint;
  v_row users;
begin
  v_id := tg_validate_init_data(p_init_data);
  if v_id is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  insert into users (telegram_id) values (v_id)
  on conflict (telegram_id) do update set updated_at = now()
  returning * into v_row;

  return json_build_object(
    'telegram_id',  v_row.telegram_id,
    'is_pro',       v_row.is_pro,
    'pro_since',    v_row.pro_since,
    'games_played', v_row.games_played
  );
end;
$$;

grant execute on function get_user_status(text) to anon, authenticated, service_role;

create or replace function pick_random_cards(
  p_count         int,
  p_categories    text[]  default null,
  p_min_pageviews bigint  default null,
  p_continents    text[]  default null,
  p_tags          text[]  default null,
  p_init_data     text    default null,  -- принят для совместимости; не используется
  p_difficulty    int     default null
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
    and (
      p_difficulty is null
      or p_difficulty <= 0
      or pageviews >= p_difficulty
      or tier in ('legendary', 'epic')
      or tags && array['wc2026']
    )
  order by random()
  limit p_count;
$$;

notify pgrst, 'reload schema';

-- VERIFY:
--   select
--     (select count(*) from information_schema.role_table_grants
--        where grantee in ('anon','authenticated') and table_schema='public'
--        and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')) as dangerous_left, -- 0
--     (select count(*) from pick_random_cards(1000))                as full_deck,      -- сотни+
--     (select count(*) from pick_random_cards(1000,null,null,null,null,null,25000)) as easy_pool;
-- ============================================================================


-- ============================================================================
-- 2026-07-18 — переводы + hardening по advisors [ПРИМЕНЕНО на проде через MCP]
--
-- 1) [БАГ] card_translations: на проде RLS был включён БЕЗ политики SELECT —
--    докатили таблицу/данные из docs/card_translations.sql, но не секцию RLS.
--    Приложение видело 0 строк: переводы имён на всех 7 языках (19751 строка)
--    молча не работали. Политика восстановлена ровно как в исходном файле.
-- 2) Фиксированный search_path у pick_random_cards / get_room_scores /
--    _tg_url_decode / set_room_code / generate_room_code (advisors WARN
--    "role mutable search_path").
-- 3) Индексы под FK на горячих путях: room_players(player_id) — его теперь
--    использует восстановление сессии после reload, scores(round_id),
--    rounds(team_id), teams(room_id), rooms(current_round_id).
--
-- ПРОВЕРЕНО: под ролью anon видно 19751 переводов (es 3031), join с cards
-- работает. Идемпотентно.
-- ============================================================================

drop policy if exists card_translations_public_select on card_translations;
create policy card_translations_public_select on card_translations
  for select to anon, authenticated using (true);

alter function pick_random_cards(integer, text[], bigint, text[], text[], text, integer) set search_path = public;
alter function get_room_scores(uuid) set search_path = public;
alter function _tg_url_decode(text) set search_path = public;
alter function set_room_code() set search_path = public;
alter function generate_room_code() set search_path = public;

create index if not exists idx_room_players_player  on room_players(player_id);
create index if not exists idx_scores_round         on scores(round_id);
create index if not exists idx_rounds_team          on rounds(team_id);
create index if not exists idx_teams_room           on teams(room_id);
create index if not exists idx_rooms_current_round  on rooms(current_round_id);

notify pgrst, 'reload schema';

-- VERIFY:
--   begin; set local role anon;
--   select count(*) from card_translations;  -- ~19751, НЕ 0
--   rollback;
-- ============================================================================


-- ============================================================================
-- 2026-07-18 — онбординг строже: убрать wc2026 из исключений сложности
--                                              [ПРИМЕНЕНО на проде через MCP]
--
-- ПОЧЕМУ: у новичков было «душно» — тег wc2026 (411 игроков турнира, включая
-- специально добавленных малоизвестных прорывов) проходил мимо ЛЮБОГО порога
-- популярности и заполнял «лёгкий» пул ноунеймами. Теперь порог обходят
-- только tier legendary/epic (знамениты по определению). Фронт одновременно
-- поднял порог первых 10 игр с 25000 до 60000 pageviews: пул новичка = ~255
-- самых узнаваемых игроков + легенды/эпики.
-- Полный текст функции см. в предыдущем блоке — здесь меняется только
-- difficulty-условие: строка "or tags && array['wc2026']" УДАЛЕНА.
-- ============================================================================


-- ============================================================================
-- 2026-07-19 — Pro-чип «Легенды» пуст + колонка описаний  [ОЖИДАЕТ ПРОД]
--
-- 1) [БАГ] Чип «Легенды» у Pro-игрока серый и некликабельный: тег 'legend'
--    ни разу не бэкфиллился (0 карточек) — чип с нулём карт гасится в UI.
--    Бэкфилл из docs/cards_legend_backfill.sql, рекомендованная ветка
--    tier IN ('legendary','epic') (~197 элитных игроков). Идемпотентно.
-- 2) Тот же бэкфилл для 'ballon_dor' из титулов (facts/legend_career) —
--    чтобы и этот Pro-чип не оказался пустым.
-- 3) Колонка cards.descriptions (jsonb) — короткие описания-определения для
--    неигровых карточек ({"ru": "...", "en": "...", ...}); фронт уже умеет
--    их показывать в истории быстрой игры. Контент зальётся отдельным
--    UPDATE-блоком после наката колонки.
-- ============================================================================

update cards c
set tags = (
  select array(
    select distinct e
    from unnest(coalesce(c.tags, '{}'::text[]) || array['legend']) e
  )
)
where c.category = 'player'
  and c.active = true
  and not ('legend' = any(coalesce(c.tags, '{}'::text[])))
  and c.tier in ('legendary', 'epic');

update cards c
set tags = (
  select array(
    select distinct e
    from unnest(coalesce(c.tags, '{}'::text[]) || array['ballon_dor']) e
  )
)
where c.category = 'player'
  and c.active = true
  and not ('ballon_dor' = any(coalesce(c.tags, '{}'::text[])))
  and (
    exists (
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(c.facts->'titles') = 'array'
             then c.facts->'titles' else '[]'::jsonb end) t
      where t ilike '%золотой мяч%' or t ilike '%ballon%'
    )
    or exists (
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(c.legend_career->'titles') = 'array'
             then c.legend_career->'titles' else '[]'::jsonb end) t
      where t ilike '%золотой мяч%' or t ilike '%ballon%'
    )
  );

alter table cards add column if not exists descriptions jsonb;

notify pgrst, 'reload schema';

-- VERIFY:
--   select
--     (select count(*) from cards where active and 'legend'     = any(tags)) as legends,     -- ~197
--     (select count(*) from cards where active and 'ballon_dor' = any(tags)) as ballon_dor,  -- >0
--     (select count(*) from information_schema.columns
--        where table_name='cards' and column_name='descriptions')            as descr_col;   -- 1
-- ============================================================================


-- ============================================================================
-- 2026-07-19 — культурная локализация колоды            [ОЖИДАЕТ ПРОД]
--
-- ИДЕЯ (см. коммит фронта): pageviews собраны с РУССКОЙ Википедии, поэтому
-- «известность» в онбординге меряется по русской культуре — звезда мексикан-
-- ского ТВ для испаноязычного новичка не пройдёт порог никогда. Решение:
--   1) pick_random_cards получает p_boost_countries (text[]) — игроки из
--      стран «своей» культуры проходят онбординг-порог в 4 раза ниже;
--      p_lang (text) — комментаторы фильтруются по языку (cards.langs).
--      Фронт уже шлёт оба параметра (с graceful degrade до наката).
--   2) Колонка cards.langs text[] — языки, в чьей культуре карточка «на
--      слуху». Существующие 16 комментаторов помечаются {ru}.
--   3) КОНТЕНТ: 21 легендарный комментатор для en/es/pt/fr/ar/zh/ja/ko +
--      родные написания имён в card_translations. Идемпотентно.
-- ============================================================================

alter table cards add column if not exists langs text[];

-- Существующие комментаторы — русскоязычные (до вставки новых!)
update cards set langs = array['ru']
where category = 'commentator' and langs is null;

-- Перевыпуск pick_random_cards с локальными параметрами (сносим 7-арг
-- overload, иначе PGRST203; старые клиенты зовут по именам — 9-арг версия
-- с default'ами их обслуживает).
drop function if exists pick_random_cards(int, text[], bigint, text[], text[], text, int);

create function pick_random_cards(
  p_count           int,
  p_categories      text[]  default null,
  p_min_pageviews   bigint  default null,
  p_continents      text[]  default null,
  p_tags            text[]  default null,
  p_init_data       text    default null,  -- принят для совместимости; не используется
  p_difficulty      int     default null,
  p_boost_countries text[]  default null,
  p_lang            text    default null
)
returns setof cards
language sql
stable
set search_path = public
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
    -- Комментаторы — только «свои» для языка интерфейса; без p_lang (мульти-
    -- плеер, старые клиенты) поведение прежнее.
    and (
      category <> 'commentator'
      or p_lang is null
      or langs is null
      or p_lang = any(langs)
    )
    -- Онбординг-порог: легенды/эпики проходят всегда; «местные герои»
    -- (p_boost_countries) — со скидкой 4x, т.к. их слава недооценена
    -- русскоязычными pageviews.
    and (
      p_difficulty is null
      or p_difficulty <= 0
      or pageviews >= p_difficulty
      or tier in ('legendary', 'epic')
      or (
        p_boost_countries is not null
        and category = 'player'
        and country = any(p_boost_countries)
        and coalesce(pageviews, 0) >= greatest(p_difficulty / 4, 1)
      )
    )
  order by random()
  limit p_count;
$$;

-- ── Комментаторы по языкам (21) ──
-- name — русская транслитерация (главная колонка), родное написание уходит
-- в card_translations ниже. category_ru как у существующих комментаторов.

INSERT INTO cards (name, name_en, category, category_ru, forbidden_words, active, country, langs)
SELECT v.name, v.name_en, 'commentator', 'комментаторы', v.fw, true, v.country, v.langs
FROM (VALUES
  -- Английский
  ('Мартин Тайлер',      'Martin Tyler',       ARRAY['Мартин Тайлер','Мартин','Тайлер'],          'GB-ENG', ARRAY['en']),
  ('Питер Друри',        'Peter Drury',        ARRAY['Питер Друри','Питер','Друри'],              'GB-ENG', ARRAY['en']),
  ('Джон Мотсон',        'John Motson',        ARRAY['Джон Мотсон','Джон','Мотсон'],              'GB-ENG', ARRAY['en']),
  ('Клайв Тилдсли',      'Clive Tyldesley',    ARRAY['Клайв Тилдсли','Клайв','Тилдсли'],          'GB-ENG', ARRAY['en']),
  ('Иан Дарк',           'Ian Darke',          ARRAY['Иан Дарк','Иан','Дарк'],                    'GB-ENG', ARRAY['en']),
  -- Испанский
  ('Андрес Кантор',      'Andrés Cantor',      ARRAY['Андрес Кантор','Андрес','Кантор'],          'AR', ARRAY['es']),
  ('Кристиан Мартиноли', 'Christian Martinoli',ARRAY['Кристиан Мартиноли','Кристиан','Мартиноли'],'MX', ARRAY['es']),
  ('Андрес Монтес',      'Andrés Montes',      ARRAY['Андрес Монтес','Андрес','Монтес'],          'ES', ARRAY['es']),
  ('Маноло Лама',        'Manolo Lama',        ARRAY['Маноло Лама','Маноло','Лама'],              'ES', ARRAY['es']),
  -- Португальский
  ('Галван Буэну',       'Galvão Bueno',       ARRAY['Галван Буэну','Галван','Буэну'],            'BR', ARRAY['pt']),
  ('Клебер Машаду',      'Cléber Machado',     ARRAY['Клебер Машаду','Клебер','Машаду'],          'BR', ARRAY['pt']),
  ('Милтон Лейте',       'Milton Leite',       ARRAY['Милтон Лейте','Милтон','Лейте'],            'BR', ARRAY['pt']),
  -- Французский
  ('Тьерри Ролан',       'Thierry Roland',     ARRAY['Тьерри Ролан','Тьерри','Ролан'],            'FR', ARRAY['fr']),
  ('Грегуар Марготтон',  'Grégoire Margotton', ARRAY['Грегуар Марготтон','Грегуар','Марготтон'],  'FR', ARRAY['fr']),
  ('Омар да Фонсека',    'Omar da Fonseca',    ARRAY['Омар да Фонсека','Омар','Фонсека'],         'AR', ARRAY['fr','es']),
  -- Арабский
  ('Иссам аш-Шавали',    'Issam Chawali',      ARRAY['Иссам аш-Шавали','Иссам','Шавали'],         'TN', ARRAY['ar']),
  ('Хафид Дерраджи',     'Hafid Derradji',     ARRAY['Хафид Дерраджи','Хафид','Дерраджи'],        'DZ', ARRAY['ar']),
  ('Рауф Хлиф',          'Raouf Khlif',        ARRAY['Рауф Хлиф','Рауф','Хлиф'],                  'TN', ARRAY['ar']),
  -- Китайский
  ('Хуан Цзяньсян',      'Huang Jianxiang',    ARRAY['Хуан Цзяньсян','Хуан','Цзяньсян'],          'CN', ARRAY['zh']),
  ('Хэ Вэй',             'He Wei',             ARRAY['Хэ Вэй','Хэ','Вэй'],                        'CN', ARRAY['zh']),
  -- Японский
  ('Ясутаро Мацуки',     'Yasutaro Matsuki',   ARRAY['Ясутаро Мацуки','Ясутаро','Мацуки'],        'JP', ARRAY['ja'])
) AS v(name, name_en, fw, country, langs)
WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE lower(c.name) = lower(v.name));

-- Родные написания имён для «своих» языков
INSERT INTO card_translations (card_id, lang, name, source)
SELECT c.id, v.lang, v.native, 'label'
FROM (VALUES
  ('Иссам аш-Шавали', 'ar', 'عصام الشوالي'),
  ('Хафид Дерраджи',  'ar', 'حفيظ دراجي'),
  ('Рауф Хлиф',       'ar', 'رؤوف خليف'),
  ('Хуан Цзяньсян',   'zh', '黄健翔'),
  ('Хэ Вэй',          'zh', '贺炜'),
  ('Ясутаро Мацуки',  'ja', '松木安太郎')
) AS v(card_name, lang, native)
JOIN cards c ON lower(c.name) = lower(v.card_name)
ON CONFLICT (card_id, lang) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   select
--     (select count(*) from cards where category='commentator')                       as commentators, -- 37
--     (select count(*) from cards where category='commentator' and langs is null)     as no_langs,     -- 0
--     (select count(*) from pick_random_cards(50, array['commentator'],
--        null, null, null, null, null, null, 'es'))                                   as es_comms,     -- ~5
--     (select count(*) from pick_random_cards(1000, null, null, null, null,
--        null, 25000, array['MX'], null))                                             as boosted_draw; -- > обычного
-- ============================================================================
