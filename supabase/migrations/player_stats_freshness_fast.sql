-- Свежесть статистики: три указателя вместо прохода по всей таблице
-- ============================================================================
--
-- ⚠️ САМЫЙ ДОРОГОЙ ВЫЗОВ ПРОЕКТА НА ЕДИНИЦУ СМЫСЛА. Функция отдаёт пять чисел
-- — когда собирали, за какие даты, сколько игроков и матчей — и ради них
-- прочитывала 153 334 строки целиком, на каждое открытие экрана:
--
--     Aggregate  (actual rows=1 loops=1)
--       Buffers: shared hit=81690
--       ->  Index Scan using player_match_stats_pkey  (actual rows=153334)
--     Execution Time: 1598.625 ms
--
-- В обходе всех RPC анонимным ключом (scripts/check-limits.mjs) она дала
-- **3225 мс — то есть уже за трёхсекундным потолком anon**. Это не «медленно»,
-- это 57014 и пустая плашка вместо даты сбора.
--
-- ── ПОЧЕМУ ЗДЕСЬ НЕЛЬЗЯ ПАМЯТКУ ────────────────────────────────────────────
--
-- Соседние функции этой сессии вылечены ночным кэшем. Здесь так НЕЛЬЗЯ, и это
-- стоит сказать прямо, потому что соблазн скопировать приём очевиден:
-- `collected_at` — это и есть ОТВЕТ НА ВОПРОС «насколько свежие данные».
-- Считать его ночью значит показывать вчерашнюю свежесть как сегодняшнюю. Так
-- индикатор свежести превращается в индикатор того, что он сам устарел.
--
-- ── ЧТО СДЕЛАНО ────────────────────────────────────────────────────────────
--
-- Один общий `Aggregate` разобран на пять независимых подзапросов, и под
-- каждый заведён индекс. Минимум и максимум перестали быть проходом по
-- таблице — это два указателя на края индекса; счётчики читают узкий индекс
-- вместо кучи.
--
--   player_match_stats_match_date_idx   min/max(match_date) — по одному чтению
--   player_match_stats_fetched_at_idx   max(fetched_at)     — по одному чтению
--   player_match_stats_card_id_idx      count(distinct card_id)
--
-- ⚠️ VACUUM ОБЯЗАТЕЛЕН, И БЕЗ НЕГО ВЫИГРЫШ ВТРОЕ МЕНЬШЕ. Первый замер после
-- индексов дал 494 мс при `Heap Fetches: 62144`: карта видимости была
-- устаревшей, и index-only scan всё равно лазил в кучу. После `vacuum
-- (analyze)` — `Heap Fetches: 0` и 49 мс. Таблица наполняется ночным
-- сборщиком пачками, автовакуум за ним не успевает; если функция снова
-- замедлится, смотреть надо сюда, а не на план.
--
-- ЗАМЕР ПОСЛЕ:
--
--     Result  (actual rows=1 loops=1)
--       Buffers: shared hit=325
--     Execution Time: 49.563 ms
--
--     1598.625 мс → 49.563 мс,  81690 буферов → 325,  Heap Fetches 62144 → 0
--
-- ⚠️ ОТВЕТ ОСТАЛСЯ ЖИВЫМ И ТОЧНЫМ, НЕ ПРИБЛИЖЁННЫМ. Сверено тем же запросом
-- рядом: players 12002 = 12002, matches 153334 = 153334. Ни одного кэша, ни
-- одной оценки по reltuples — цифры по-прежнему считаются на месте.

create index if not exists player_match_stats_match_date_idx
  on public.player_match_stats (match_date);
create index if not exists player_match_stats_fetched_at_idx
  on public.player_match_stats (fetched_at desc);
create index if not exists player_match_stats_card_id_idx
  on public.player_match_stats (card_id);

create or replace function public.player_stats_freshness()
returns table (
  first_match  date,
  last_match   date,
  collected_at timestamptz,
  players      integer,
  matches      integer
)
language sql stable as $$
  select
    (select min(s.match_date)  from public.player_match_stats s),
    (select max(s.match_date)  from public.player_match_stats s),
    (select max(s.fetched_at)  from public.player_match_stats s),
    -- `count(distinct card_id)` планировщик не умеет отдать index-only scan'ом;
    -- явный `distinct` в подзапросе — умеет (Unique поверх Index Only Scan).
    (select count(*) from (select distinct s.card_id from public.player_match_stats s) u)::int,
    (select count(*) from public.player_match_stats s)::int;
$$;

-- Разово: индексы построены по старой карте видимости.
-- vacuum нельзя выполнить внутри транзакции, поэтому он вынесен отдельной
-- командой при применении: vacuum (analyze) public.player_match_stats;
