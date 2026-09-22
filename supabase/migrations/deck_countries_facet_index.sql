-- Список стран в подборе колоды: 1749 мс → 33 мс одним покрывающим индексом.
--
-- ⚠️ НАШЛОСЬ НЕ ПРОВЕРКОЙ, А ТЕМ, ЧТО ОТЧЁТ КРАСНЕЛ ЧЕРЕЗ РАЗ. Три прогона
-- `check-prod` подряд на неизменном коде дали 4, 1 и 0 падений; среди падавших
-- была «Страны колоды: список полный» с текстом «0 стран запросом против 100
-- чтением строк». Ноль означает не пустую колоду, а ОТКАЗ: у анонима
-- `statement_timeout` = 3 секунды, и вхолодную вызов шёл 4,5 с.
--
-- То есть это не придирка к проверке. Это значит, что игрок, открывший фильтр
-- колоды на холодной базе, видит пустой список стран — и ничего об этом не
-- узнаёт, потому что экран не падает.
--
-- ПРИЧИНА. `deck_countries` группирует по стране всех активных игроков.
-- Единственный подходящий индекс — `idx_cards_active_category` — знает только
-- `category`, поэтому 25 237 строк доставались ИЗ КУЧИ ради одной колонки:
--
--   Index Scan using idx_cards_active_category  (actual time=4.478..1727.618 rows=25237)
--     Buffers: shared hit=4214
--   Execution Time: 1749.050 ms
--
-- ПОСЛЕ. Колонка `country` в самом индексе — скан становится index-only:
--
--   Index Only Scan using cards_country_facet_idx  (actual time=2.527..28.029 rows=25237)
--   Execution Time: 33.198 ms
--
-- ⚠️ ИНДЕКС ЧАСТИЧНЫЙ, И ОБА УСЛОВИЯ ОБЯЗАТЕЛЬНЫ. `where active` повторяет
-- предикат функции (без него планировщик не сможет доказать, что индекса
-- достаточно, и вернётся к куче), `country is not null` убирает 271 строку,
-- которые всё равно отфильтровываются.
--
-- Замер 22.09.2026, 25 237 карточек игроков со страной.

create index if not exists cards_country_facet_idx
  on public.cards (category, country)
  where active and country is not null;

-- ⚠️ ANALYZE ЗДЕСЬ НЕ РИТУАЛ: без свежей статистики планировщик выбирал
-- прежний план и после создания индекса.
analyze public.cards;

-- Проверить самому:
--   explain (analyze, buffers)
--   select c.country, count(*)::integer from cards c
--    where c.active and c.category = 'player' and c.country is not null
--    group by c.country order by count(*) desc, c.country;
