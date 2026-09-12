-- ============================================================================
-- Категория в «коллекциях» перестаёт стоить полтора прохода по всей колоде.
--
-- Владелец: «„коллекции“ очень сильно зависают, когда нажимаешь на какую либо
-- категорию „термины“ или „клубы“».
--
-- ⚠️ ЭТО ТРЕТИЙ СЛУЧАЙ ОДНОЙ И ТОЙ ЖЕ БОЛЕЗНИ, И ЛЕЧИТЬ ЕЁ ЗАПЛАТКАМИ БОЛЬШЕ
-- НЕЛЬЗЯ. Первым был отбор по клубу и лиге (collection_generic_plan.sql), там
-- помог список id в `as materialized`. Теперь ровно то же вылезло на КАТЕГОРИИ,
-- и приём со списком тут не работает: список сузит выборку, но снаружи всё
-- равно останется проход по `cards`.
--
-- Замер 12.09.2026, категория «термины» (их в колоде 84 из 27 098):
--
--   через функцию (параметр связан):  4 822 буфера, 1 812 мс
--   тот же запрос с литералом:           70 буферов,     1.9 мс
--
-- Разница в 950 раз, и индекс `idx_cards_active_category` при этом СУЩЕСТВУЕТ.
-- Он просто неприменим: `p_category is null or p_category = '' or c.category =
-- p_category` в обобщённом плане не сворачивается, и остаётся полный проход.
-- Фасеты под чипами (`collection_facets`) больны тем же — 5 683 буфера, 445 мс
-- на той же категории. Вместе это 2.3 секунды на одно нажатие, а на холодную —
-- и трёхсекундный лимит anon.
--
-- ЛЕКАРСТВО — СОБИРАТЬ ЗАПРОС ПОД ТЕ ПАРАМЕТРЫ, КОТОРЫЕ РЕАЛЬНО ЗАДАНЫ.
-- Условия, которых нет, в текст не попадают вовсе — значит планировщику нечего
-- «не сворачивать», и он выбирает индекс. Значения подставляются через
-- `format(%L)`: это не склейка строк, `%L` экранирует и кавычит сам, так что
-- одинарная кавычка в поиске остаётся данными.
--
-- ⚠️ ПЛАН ТЕПЕРЬ СТРОИТСЯ КАЖДЫЙ ВЫЗОВ, И ЭТО ОСОЗНАННАЯ ЦЕНА. `execute` не
-- кэширует план. Замер: планирование 3.7 мс, исполнение 1.9 мс — вместе 5.6 мс
-- против прежних 1 812. Кэш, который приходится обходить, дороже кэша, которого
-- нет.
-- ============================================================================

create or replace function collection_page(
  p_lang text,
  p_category text default null,
  p_query text default null,
  p_limit integer default 48,
  p_offset integer default 0,
  p_club_key text default null,
  p_league text default null,
  p_country text default null,
  p_sort text default 'views'
)
returns setof cards
language plpgsql stable set search_path = public as $$
declare
  v_sql text := 'select c.* from cards c where c.active';
  v_lang text := left(coalesce(p_lang, 'ru'), 2);
begin
  if p_category is not null and p_category <> '' then
    v_sql := v_sql || format(' and c.category = %L', p_category);
  end if;

  if p_query is not null and p_query <> '' then
    -- Поиск идёт по обоим написаниям: русское в `name`, латиница в `name_en`.
    v_sql := v_sql || format(
      ' and (c.name ilike %L or c.name_en ilike %L)',
      '%' || p_query || '%', '%' || p_query || '%');
  end if;

  if p_country is not null and p_country <> '' then
    v_sql := v_sql || format(' and c.country = %L', p_country);
  end if;

  -- ⚠️ ОТБОР ПО КЛУБУ И ЛИГЕ — ВСЁ ЕЩЁ СПИСКОМ id, А НЕ СОЕДИНЕНИЕМ. Причина
  -- прежняя (collection_generic_plan.sql), и она никуда не делась: соединение
  -- отрабатывает на всех карточках. Разница лишь в том, что теперь этот кусок
  -- ПОЯВЛЯЕТСЯ В ТЕКСТЕ только когда по клубу действительно отбирают.
  if p_club_key is not null and p_club_key <> '' then
    v_sql := v_sql || format(
      ' and c.id in (select cc.card_id from card_current_club cc where cc.club_key = %L)',
      p_club_key);
  end if;

  if p_league is not null and p_league <> '' then
    v_sql := v_sql || format(
      ' and c.id in (select cc.card_id from card_current_club cc'
      || ' join football_club fc on fc.club_key = cc.club_key where fc.league = %L)',
      p_league);
  end if;

  -- Порядок: стоимость, рейтинг или просмотры. Прежнее умолчание сохранено —
  -- экран не должен измениться у того, кто ничего не выбирал.
  if p_sort = 'value' then
    v_sql := v_sql || ' order by c.market_value_eur desc nulls last';
  elsif p_sort = 'rating' then
    v_sql := v_sql || ' order by c.sw_rating desc nulls last';
  else
    v_sql := v_sql || format(
      ' order by collection_views(c.pageviews, c.pageviews_i18n, %L) desc nulls last',
      v_lang);
  end if;
  v_sql := v_sql || ', coalesce(c.pageviews, 0) desc, c.name asc';

  v_sql := v_sql || format(' limit %s offset %s',
    greatest(coalesce(p_limit, 48), 0), greatest(coalesce(p_offset, 0), 0));

  return query execute v_sql;
end;
$$;

-- ⚠️ СТАРАЯ ПЯТИПАРАМЕТРОВАЯ ПЕРЕГРУЗКА НЕ УДАЛЕНА, А ПЕРЕВЕДЕНА НА НОВУЮ.
-- Её зовёт бандл, выложенный до появления фильтров, и у части читателей он
-- живёт в кэше телефона. Удалить её — это уронить экран ровно у тех, кто давно
-- не перезаходил; оставить как была — это оставить им же те самые 1 812 мс.
create or replace function collection_page(
  p_lang text,
  p_category text default null,
  p_query text default null,
  p_limit integer default 48,
  p_offset integer default 0
)
returns setof cards
language sql stable set search_path = public as $$
  select * from collection_page(p_lang, p_category, p_query, p_limit, p_offset,
                                null, null, null, 'views');
$$;

-- ─── Фасеты под чипами ──────────────────────────────────────────────────────
--
-- Та же правка и по той же причине: 445 мс и 5 683 буфера там, где строк 84.
-- Здесь полный проход дороже вдвойне — на каждую карточку идут ДВА соединения
-- (`card_current_club`, `football_club`), и без категории в тексте они
-- отрабатывают на всей колоде.
create or replace function collection_facets(
  p_category text default 'player',
  p_max_clubs integer default 300
)
returns table (kind text, value text, label text, n integer)
language plpgsql stable security definer set search_path = public
set statement_timeout to '30s' as $$
declare
  v_where text := 'where c.active';
begin
  if p_category is not null and p_category <> '' then
    v_where := v_where || format(' and c.category = %L', p_category);
  end if;

  return query execute format($q$
    with base as (
      select c.id, c.country, cc.club_key, fc.league, fc.name as club_name
        from cards c
        left join card_current_club cc on cc.card_id = c.id
        left join football_club fc on fc.club_key = cc.club_key
        %s
    ),
    leagues as (
      select 'league'::text as kind, league as value, league as label,
             count(*)::int as n, 1 as ord
        from base where league is not null group by league
    ),
    countries as (
      select 'country'::text, country, country, count(*)::int, 2
        from base where country is not null group by country
    ),
    clubs as (
      select 'club'::text, club_key, max(club_name), count(*)::int, 3
        from base where club_key is not null group by club_key
       order by count(*) desc, club_key
       limit %s
    )
    select kind, value, label, n from (
      select * from leagues
      union all select * from countries
      union all select * from clubs
    ) t
    order by ord, n desc, label
  $q$, v_where, greatest(coalesce(p_max_clubs, 300), 1));
end;
$$;

revoke all on function collection_page(text, text, text, integer, integer, text, text, text, text) from public;
revoke all on function collection_page(text, text, text, integer, integer) from public;
revoke all on function collection_facets(text, integer) from public;
grant execute on function collection_page(text, text, text, integer, integer, text, text, text, text) to anon, authenticated, service_role;
grant execute on function collection_page(text, text, text, integer, integer) to anon, authenticated, service_role;
grant execute on function collection_facets(text, integer) to anon, authenticated, service_role;
