-- Экраны «Коллекция» и «Рейтинг футболистов» выключались при открытии.
-- ==========================================================================
--
-- Владелец: «приложение начало выключаться при открытии „коллекций“ и
-- „рейтинга футболистов“, такого ещё не было».
--
-- ПРИЧИНА — НЕ ОБЪЁМ ДАННЫХ, А ОБОБЩЁННЫЙ ПЛАН. Обе функции написаны на
-- LANGUAGE sql и вызываются через PostgREST, то есть параметры приходят
-- связанными ($1..$9), а не литералами. После нескольких вызовов Postgres
-- переходит на generic plan, и там `p_club_key is null` — уже не константа,
-- которую можно свернуть. Значит:
--
--   * `left join card_current_club` и `left join football_club`, нужные
--     ТОЛЬКО отбору по клубу и лиге, из плана не выкидываются;
--   * выборка оценивается в одну строку, и планировщик берёт вложенный цикл;
--   * на каждую из 27 098 карточек делается два индексных захода.
--
-- Замерено на проде, `explain (analyze, buffers)`, прогретый кеш:
--
--                                        БЫЛО                 СТАЛО
--   collection_page, «Все»       155 533 буфера   462 мс     5 700    162 мс
--   collection_page, фильтр АПЛ  156 252 буфера  1016 мс     5 590     49 мс
--   player_index, без фильтров   229 708 буферов 1351 мс     6 993    269 мс
--   player_index, фильтр АПЛ     131 258 буферов  480 мс     7 733    209 мс
--   player_index_count           81 522 буфера    279 мс     5 544    143 мс
--
-- Прогретые сотни миллисекунд безобидны, но у anon лимит запроса 3 секунды, а
-- холодный заход читает эти 155 тысяч страниц с диска. Отсюда и наблюдавшееся
-- `57014 canceling statement due to statement timeout` на 4.08 с при
-- p_category = null — то есть на фильтре «Все», который стоит по умолчанию.
-- fetchCollection() делает `if (error) throw error`, экран падает целиком.
--
-- ЛЕЧЕНИЕ — УБРАТЬ СОЕДИНЕНИЕ ИЗ ГОРЯЧЕГО ПУТИ, А НЕ ПОДПЕРЕТЬ ИНДЕКСОМ.
-- Три приёма, каждый проверен замером:
--
--   1. Отбор по клубу и лиге — СПИСКОМ id, собранным один раз, и `in` по
--      нему. `left join` — конструкция плана, она отрабатывает всегда;
--      `or ... in (...)` замыкается НА ИСПОЛНЕНИИ: когда параметр null, до
--      списка дело не доходит вовсе.
--
--   2. ⚠️ В САМИХ СПИСКАХ НЕТ ПРОВЕРКИ `p_league is not null` — НАРОЧНО.
--      С ней планировщик оценивает список в одну строку, хеш не строит и
--      перечитывает список на каждую строку: 2 362 мс против 209 при тех же
--      7 733 буферах. Без неё оценка обычная и `in` становится hashed SubPlan.
--      Когда параметр null, `fc.league = null` не даёт ни строки — что и
--      требуется, а исполнение туда всё равно не заходит.
--
--   3. `as materialized` в player_index — ЗАСЛОН ДЛЯ ПЛАНИРОВЩИКА. Внутри
--      pool нет ни одного параметра-фильтра, поэтому cards с player_level
--      соединяются по настоящей статистике: hash join на 25 508 строк вместо
--      25 тысяч заходов в player_level_pkey.
--
-- Проверено обоими планами (`set local plan_cache_mode = force_generic_plan`
-- и обычным) и на совпадение выдачи: первые 48 карточек коллекции и первые
-- 50 строк рейтинга совпадают с прежними ПОСТРОЧНО И ПО ПОРЯДКУ, для «Все»
-- и для фильтра по лиге, для ru и для en; player_index_count даёт те же
-- 25 508 и 537. Отрицательный контроль — в scripts/check-prod.mjs.

-- --------------------------------------------------------------------------
-- 1. collection_page — каталог коллекции
-- --------------------------------------------------------------------------
-- Тип возврата и список параметров прежние, поэтому `create or replace`
-- ложится поверх существующей сигнатуры. Гранты перечислены явно.

create or replace function public.collection_page(
  p_lang     text,
  p_category text default null,
  p_query    text default null,
  p_limit    integer default 48,
  p_offset   integer default 0,
  p_club_key text default null,
  p_league   text default null,
  p_country  text default null,
  p_sort     text default 'views'
) returns setof cards
language sql
stable
set search_path to 'public'
as $$
  -- ⚠️ ОТБОР ПО КЛУБУ И ЛИГЕ — СПИСКОМ, А НЕ СОЕДИНЕНИЕМ И НЕ exists НА
  -- СТРОКУ. PostgREST шлёт параметры связанными, Postgres берёт обобщённый
  -- план, и `p_club_key is null` там уже не сворачивается. Два прежних
  -- `left join` отрабатывали на всех 27 098 карточках даже тогда, когда по
  -- клубу никто не отбирал: 155 533 буфера против 5 700 — и холодный заход
  -- упирался в трёхсекундный лимит anon. См.
  -- supabase/migrations/collection_generic_plan.sql.
  --
  -- В списках нет проверки `p_league is not null` — нарочно: с ней оценка
  -- падает до одной строки, хеш не строится, и список перечитывается на
  -- каждую строку. Когда параметр null, `fc.league = null` не даёт ни строки,
  -- а до самого списка исполнение и не доходит — `or` замыкается раньше.
  with by_club as materialized (
    select cc.card_id from card_current_club cc where cc.club_key = p_club_key
  ),
  by_league as materialized (
    select cc.card_id from card_current_club cc
       join football_club fc on fc.club_key = cc.club_key
     where fc.league = p_league
  )
  select c.*
  from cards c
  where c.active
    and (p_category is null or p_category = '' or c.category = p_category)
    and (p_query is null or p_query = ''
         or c.name ilike '%' || p_query || '%'
         or c.name_en ilike '%' || p_query || '%')
    and (p_country  is null or p_country  = '' or c.country = p_country)
    and (p_club_key is null or p_club_key = '' or c.id in (select card_id from by_club))
    and (p_league   is null or p_league   = '' or c.id in (select card_id from by_league))
  order by
    case when p_sort = 'value'  then c.market_value_eur end desc nulls last,
    case when p_sort = 'rating' then c.sw_rating        end desc nulls last,
    -- Просмотры — прежний порядок и умолчание: экран не должен измениться
    -- у того, кто ничего не выбирал.
    case when p_sort = 'value' or p_sort = 'rating' then null else
      collection_views(c.pageviews, c.pageviews_i18n, left(coalesce(p_lang, 'ru'), 2))
    end desc nulls last,
    coalesce(c.pageviews, 0) desc,
    c.name asc
  limit  greatest(coalesce(p_limit, 48), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.collection_page(
  text, text, text, integer, integer, text, text, text, text)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. player_index — рейтинг футболистов
-- --------------------------------------------------------------------------
-- Колонки возврата те же, колонка в колонку, иначе Postgres потребует drop.
--
-- Кроме списков отбора здесь два отличия от прежней версии, оба ради плана:
--   * ранжируется УЗКАЯ проекция (id, ключ сортировки, parts, имя). Прежняя
--     сортировала 25 тысяч строк со всеми колонками и сбрасывала 541 блок
--     во временные файлы; work_mem поднят, чтобы не сбрасывать и эти;
--   * club_key, название клуба и лига берутся ПОСЛЕ limit — на 50 строках,
--     а не на 25 тысячах.

create or replace function public.player_index(
  p_sort      text default 'index',
  p_league    text default null,
  p_country   text default null,
  p_club_key  text default null,
  p_lang      text default 'ru',
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_continent text default null
) returns table (
  card_id uuid, name text, name_en text, photo_url text,
  country text, continent text, club_key text, club text, league text,
  index_score smallint, parts smallint, value_part smallint,
  views_part smallint, stats_part smallint, news_part smallint,
  sort_value numeric, place integer
)
language sql
stable security definer
set search_path to 'public'
set statement_timeout to '60s'
set work_mem to '8MB'
as $$
  -- ⚠️ `as materialized` — ЗАСЛОН ДЛЯ ПЛАНИРОВЩИКА, А НЕ УКРАШЕНИЕ.
  -- Внутри pool нет ни одного параметра-фильтра, поэтому соединение cards с
  -- player_level планируется по настоящей статистике: hash join на 25 508
  -- строк. Стоит пустить сюда `p_country is null or ...` — оценка падает до
  -- одной строки, планировщик берёт вложенный цикл и делает 25 тысяч заходов
  -- в player_level_pkey: 229 708 буферов вместо 7 006. Так и было.
  with pool as materialized (
    select c.id, c.name, c.country, c.continent, pl.parts,
           case coalesce(nullif(p_sort, ''), 'index')
             when 'value'     then c.market_value_eur::numeric
             when 'views'     then c.pageviews::numeric
             when 'rating'    then c.sw_rating::numeric
             when 'news'      then (select h.value from card_metric_history h
                                     where h.card_id = c.id and h.metric = 'news_30d'
                                     order by h.taken_on desc limit 1)
             when 'stats'     then (select sum(s.minutes)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             when 'goals'     then (select sum(s.goals)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             -- Пять новых показателей. Все считаются ночью и лежат колонками:
             -- считать их в запросе списка значит делать это для всех 25 508
             -- карточек при каждом открытии экрана.
             when 'growth'    then pl.value_growth
             when 'caps'      then pl.caps::numeric
             when 'countries' then pl.countries::numeric
             when 'cards'     then pl.foul_cards::numeric
             -- ⚠️ «МОЛОДЫЕ» — ЭТО ДАТА РОЖДЕНИЯ ЧИСЛОМ, А НЕ ВОЗРАСТ. Сортируем
             -- по возрастанию возраста, то есть по УБЫВАНИЮ даты; чтобы общий
             -- порядок «больше значит выше» не выворачивался для одной кнопки,
             -- берём саму дату как число дней.
             when 'young'     then extract(epoch from c.born_on)::numeric
             else pl.index_score::numeric
           end as sort_value
      from cards c
      join player_level pl on pl.card_id = c.id
     where c.active and c.category = 'player'
  ),
  -- Отбор по клубу и лиге — СПИСКОМ, СОБРАННЫМ ОДИН РАЗ, а не подзапросом на
  -- каждую из 25 тысяч строк: с `exists` на строку выходило 131 258 буферов.
  --
  -- ⚠️ ЗДЕСЬ НЕТ `p_league is not null and ...` — И ЭТО НАРОЧНО. С такой
  -- проверкой планировщик оценивает список в одну строку, не строит по нему
  -- хеш и перечитывает его на каждую строку pool: 2 362 мс против 209. Без
  -- неё оценка обычная, `in` превращается в hashed SubPlan. Когда параметр
  -- null, `fc.league = null` не даёт ни строки — а до самого списка
  -- исполнение и не доходит, `or` замыкается раньше.
  by_club as materialized (
    select cc.card_id from card_current_club cc where cc.club_key = p_club_key
  ),
  by_league as materialized (
    select cc.card_id from card_current_club cc
       join football_club fc on fc.club_key = cc.club_key
     where fc.league = p_league
  ),
  scoped as (
    select p.id, p.name, p.parts, p.sort_value
      from pool p
     where p.sort_value is not null
       and (p_country   is null or p_country   = '' or p.country   = p_country)
       and (p_continent is null or p_continent = '' or p.continent = p_continent)
       and (p_club_key  is null or p_club_key  = '' or p.id in (select card_id from by_club))
       and (p_league    is null or p_league    = '' or p.id in (select card_id from by_league))
  ),
  ranked as (
    select s.id, s.sort_value,
           row_number() over (
             order by s.sort_value desc nulls last,
                      s.parts desc nulls last, s.name)::integer as place
      from scoped s
  ),
  page as (
    select r.id, r.sort_value, r.place
      from ranked r
     order by r.place
     limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  -- Клуб и лига берутся ПОСЛЕ limit: на 50 строках, а не на 25 тысячах.
  select c.id, c.name, c.name_en, c.photo_url, c.country, c.continent,
         cc.club_key,
         case when cc.club_key is null then null
              else club_display_name(cc.club_key, p_lang) end,
         fc.league,
         pl.index_score, pl.parts, pl.value_part, pl.views_part,
         pl.stats_part, pl.news_part, p.sort_value, p.place
    from page p
    join cards c on c.id = p.id
    join player_level pl on pl.card_id = p.id
    left join card_current_club cc on cc.card_id = p.id
    left join football_club fc on fc.club_key = cc.club_key
   order by p.place;
$$;

grant execute on function public.player_index(
  text, text, text, text, text, integer, integer, text)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. player_index_count — число строк под тем же отбором
-- --------------------------------------------------------------------------

create or replace function public.player_index_count(
  p_sort      text default 'index',
  p_league    text default null,
  p_country   text default null,
  p_club_key  text default null,
  p_continent text default null
) returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  -- Тот же заслон, что в player_index: параметры-фильтры не должны попадать
  -- в CTE, где cards соединяется с player_level, иначе оценка падает до
  -- одной строки и вместо hash join получается 25 тысяч заходов в индекс —
  -- 81 522 буфера против 5 544.
  with pool as materialized (
    select c.id, c.country, c.continent,
           c.market_value_eur, c.pageviews, c.sw_rating, c.born_on,
           pl.value_growth, pl.caps, pl.countries, pl.foul_cards, pl.index_score
      from cards c
      join player_level pl on pl.card_id = c.id
     where c.active and c.category = 'player'
  ),
  by_club as materialized (
    select cc.card_id from card_current_club cc where cc.club_key = p_club_key
  ),
  by_league as materialized (
    select cc.card_id from card_current_club cc
       join football_club fc on fc.club_key = cc.club_key
     where fc.league = p_league
  )
  select count(*)::integer
    from pool p
   where (p_country   is null or p_country   = '' or p.country   = p_country)
     and (p_continent is null or p_continent = '' or p.continent = p_continent)
     and (p_club_key  is null or p_club_key  = '' or p.id in (select card_id from by_club))
     and (p_league    is null or p_league    = '' or p.id in (select card_id from by_league))
     and case coalesce(nullif(p_sort, ''), 'index')
           when 'value'     then p.market_value_eur is not null
           when 'views'     then p.pageviews is not null
           when 'rating'    then p.sw_rating is not null
           when 'young'     then p.born_on is not null
           when 'growth'    then p.value_growth is not null
           when 'caps'      then p.caps is not null
           when 'countries' then p.countries is not null
           when 'cards'     then p.foul_cards is not null
           when 'stats'     then exists (select 1 from player_season_stat s where s.card_id = p.id)
           when 'goals'     then exists (select 1 from player_season_stat s where s.card_id = p.id)
           else p.index_score is not null
         end;
$$;

grant execute on function public.player_index_count(text, text, text, text, text)
  to anon, authenticated, service_role;
