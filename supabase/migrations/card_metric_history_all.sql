-- ===========================================================================
-- ИСТОРИЯ ИЗМЕНЕНИЙ ГЛАВНЫХ ПОКАЗАТЕЛЕЙ — ВСЕХ карточек игроков.
--
-- Владелец: «сделай историю изменений главных показателей всех карточек
-- игроков». Слово «всех» здесь и есть задача: система уже была, но покрывала
-- не всех и не всё.
--
-- ЗАМЕР ДО (06.09.2026, 25 509 действующих игроков):
--   у 2 664 карточек в истории НЕ БЫЛО НИ ОДНОЙ СТРОКИ — снимок брал только
--   не-null значения, и карточка без единого показателя просто не попадала в
--   таблицу. Её не существовало для динамики вовсе;
--   стоимости нет у 4 794 — про них история молчала, и день, когда стоимость
--   появится, ничем не отличался бы от «была всегда»;
--   статистики в показателях не было вообще, хотя владелец назвал её среди
--   четырёх главных: «новости, стоимость, статистика, просмотры»;
--   новостей тоже не было — их выбросили, когда сопоставление по `ilike`
--   упиралось в таймаут.
--
-- ЧТО ИЗМЕНИЛОСЬ ЗДЕСЬ.
--
-- 1) ХРАНИМ ИЗМЕНЕНИЯ, А НЕ ЕЖЕНОЧНЫЙ СЛЕПОК. Владелец просил «историю
--    ИЗМЕНЕНИЙ». Строка пишется, только если значение отличается от последнего
--    сохранённого. Ежедневная копия одного и того же числа — это 280 тысяч
--    строк в сутки, в которых изменение не найти глазами; тут же каждая строка
--    и ЕСТЬ событие.
--    ⚠️ ЧИТАТЬ ТЕПЕРЬ НАДО «ПОСЛЕДНЮЮ СТРОКУ НЕ ПОЗЖЕ ДАТЫ», а не «строку за
--    эту дату»: сегодняшней строки у неизменившегося показателя НЕТ.
--
-- 2) ОТСУТСТВИЕ ЧИСЛА — ТОЖЕ ЗАПИСЬ. `value` стал nullable. NULL значит «в
--    этот день числа не было», и это другое утверждение, чем ноль. Благодаря
--    ему день появления стоимости у малоизвестного игрока виден как событие, а
--    не теряется в тишине.
--
-- 3) НОЛЬ И NULL РАЗВЕДЕНЫ ПО СМЫСЛУ, и это не педантизм:
--      news_30d           — всегда ЧИСЛО, ноль в том числе: новости ищутся по
--                           всем карточкам, и «не упоминался» — это результат;
--      goals_30d/assists  — NULL, если у карточки нет ни одного матча в
--                           player_match_days: там всего 1 264 карточки, и
--                           ноль голов у остальных означал бы «не забивал»,
--                           тогда как правда — «его лигу мы не собираем»;
--      market_value, pageviews, sw_rating, fame, career_* — NULL, когда числа
--                           нет: ноль тут соврал бы про бесплатного игрока.
--
-- 4) НОВОСТИ ВЕРНУЛИСЬ, И ДЕШЕВО. Прежнее сопоставление шло через `ilike` по
--    25 509 именам и упиралось в таймаут. Здесь — GIN по tsvector и поиск
--    ФРАЗОЙ: полное имя целиком, а не фамилия. Замер на бою: 885 мс на все
--    24 915 имён. Фраза важна ещё и по смыслу — по фамилии «Silva» совпало бы
--    полсотни разных людей.
--    ⚠️ Имена короче двух слов в поиск не идут: одно слово — не имя, а ловушка.
--
-- 5) ПРЕДОХРАНИТЕЛЬ ОТ МОЛЧАЛИВОЙ ПОЛОМКИ ИСТОЧНИКА. Если у показателя разом
--    исчезло больше половины значений — это не «все подешевели», это сломался
--    сборщик. Такой показатель за ночь ПРОПУСКАЕТСЯ целиком и называется в
--    ответе функции. Без этого одна сломанная ночь записала бы двадцать тысяч
--    строк «стоимость пропала», и отличить их от правды было бы уже нельзя.
-- ===========================================================================

alter table public.card_metric_history alter column value drop not null;

-- Поисковый вектор новости: заголовок и описание одним полем, GIN сверху.
alter table public.news_items
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))
  ) stored;

create index if not exists news_items_search_idx on public.news_items using gin (search_tsv);
create index if not exists news_items_published_idx on public.news_items (published_at desc);

-- --------------------------------------------------------------------------
-- Сегодняшние значения всех главных показателей — по ВСЕМ действующим
-- карточкам игроков. Отдельной функцией, чтобы её же мог позвать тест.
-- --------------------------------------------------------------------------
create or replace function public.card_metrics_today()
returns table (card_id uuid, metric text, value numeric)
language sql stable security definer set search_path = public
set statement_timeout = '300s' as $$
  with base as (
    select id from cards where active and category = 'player'
  ),
  career as (
    select s.card_id,
           sum(s.apps)::numeric    as apps,
           sum(s.goals)::numeric   as goals,
           sum(s.assists)::numeric as assists,
           sum(s.minutes)::numeric as minutes
      from player_season_stat s
      left join tm_club k on k.id = s.club_id
     where s.card_id is not null
       and not coalesce(k.is_national_team, false)
     group by s.card_id
  ),
  -- Ноль здесь — правда только у тех, чьи матчи мы вообще собираем.
  form as (
    select d.card_id,
           sum(coalesce(d.goals, 0)) filter (
             where d.match_date >= current_date - 30)::numeric as goals_30d,
           sum(coalesce(d.assists, 0)) filter (
             where d.match_date >= current_date - 30)::numeric as assists_30d
      from player_match_days d
     group by d.card_id
  ),
  news as (
    select c.id as card_id, count(n.id)::numeric as mentions
      from cards c
      left join news_items n
        on n.published_at > now() - interval '30 days'
       and (n.search_tsv @@ phraseto_tsquery('simple', c.name)
            or (c.name_en is not null
                and n.search_tsv @@ phraseto_tsquery('simple', c.name_en)))
     where c.active and c.category = 'player'
       -- Одно слово — не имя: по нему совпадёт пол-ленты.
       and array_length(string_to_array(btrim(c.name), ' '), 1) >= 2
     group by c.id
  )
  select b.id, m.metric, m.value
    from base b
    join cards c on c.id = b.id
    left join career cr on cr.card_id = b.id
    left join form   f  on f.card_id  = b.id
    left join news   nw on nw.card_id = b.id
    cross join lateral (values
      ('market_value',    c.market_value_eur::numeric),
      ('pageviews',       c.pageviews::numeric),
      ('sw_rating',       c.sw_rating::numeric),
      ('fame',            c.fame::numeric),
      ('career_apps',     cr.apps),
      ('career_goals',    cr.goals),
      ('career_assists',  cr.assists),
      ('career_minutes',  cr.minutes),
      ('goals_30d',       f.goals_30d),
      ('assists_30d',     f.assists_30d),
      -- coalesce ТОЛЬКО здесь: ноль упоминаний — измеренный результат.
      ('news_30d',        coalesce(nw.mentions, 0))
    ) as m(metric, value);
$$;

revoke all on function public.card_metrics_today() from public;
grant execute on function public.card_metrics_today() to service_role;

-- --------------------------------------------------------------------------
-- Ночной шаг: записать ТОЛЬКО изменившееся, пропустив сломавшиеся показатели.
--
-- ⚠️ DROP ПЕРЕД CREATE ОБЯЗАТЕЛЕН. Функция возвращала integer, а теперь ещё и
-- список пропущенных показателей. `create or replace` менять тип возврата не
-- умеет и падает; этот проект на такой замене уже спотыкался — там, где список
-- параметров расширяли, получалась ВТОРАЯ функция, и прод звал старую.
-- --------------------------------------------------------------------------
drop function if exists public.snapshot_card_metrics();

create or replace function public.snapshot_card_metrics()
returns table (written integer, skipped text[])
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare
  v_written integer := 0;
  v_skipped text[]  := '{}';
begin
  -- Одним запросом, без временных таблиц: два вызова card_metrics_today() —
  -- это два прохода по всей базе, а materialized гарантирует один.
  with now_v as materialized (
    select * from card_metrics_today()
  ),
  last_v as materialized (
    select distinct on (h.card_id, h.metric) h.card_id, h.metric, h.value
      from card_metric_history h
     order by h.card_id, h.metric, h.taken_on desc
  ),
  -- Предохранитель: показатель, потерявший больше половины значений, — это
  -- сломанный сборщик, а не событие. Такой пропускаем целиком и называем.
  -- Порог в 100 значений — чтобы редкий показатель не признали сломанным
  -- из-за пары исчезнувших строк.
  broken as (
    select n.metric
      from (select metric, count(value) as have from now_v  group by metric) n
      join (select metric, count(value) as have from last_v group by metric) l
        on l.metric = n.metric
     where l.have >= 100 and n.have < l.have / 2
  ),
  ins as (
    insert into card_metric_history (card_id, metric, taken_on, value)
    select n.card_id, n.metric, (now() at time zone 'utc')::date, n.value
      from now_v n
      left join last_v l on l.card_id = n.card_id and l.metric = n.metric
     where n.metric not in (select metric from broken)
       -- Пишем только ИЗМЕНЕНИЕ. `is distinct from` — не придирка: обычное
       -- `<>` считает сравнение с NULL неизвестностью, и переход «числа не
       -- было → число появилось» не записался бы вовсе.
       and (l.card_id is null or l.value is distinct from n.value)
    on conflict (card_id, metric, taken_on) do update set value = excluded.value
    returning 1
  )
  select (select count(*)::integer from ins),
         (select coalesce(array_agg(b.metric order by b.metric), '{}') from broken b)
    into v_written, v_skipped;

  return query select v_written, v_skipped;
end;
$$;

revoke all on function public.snapshot_card_metrics() from public;
grant execute on function public.snapshot_card_metrics() to service_role;

-- --------------------------------------------------------------------------
-- ЧТЕНИЕ ДЛЯ КАРТОЧКИ: история одного показателя одной карточки.
--
-- ⚠️ ХРАНЯТСЯ ИЗМЕНЕНИЯ, ПОЭТОМУ ПОСЛЕДНЯЯ ТОЧКА ДОСТАВЛЯЕТСЯ ОТДЕЛЬНО.
-- Иначе график показателя, не менявшегося месяц, обрывался бы месяц назад и
-- читался как «данные кончились».
-- --------------------------------------------------------------------------
create or replace function public.card_metric_series(
  p_card_id uuid,
  p_metric  text default null,
  p_days    integer default 365
)
returns table (metric text, taken_on date, value numeric, is_current boolean)
language sql stable security definer set search_path = public as $$
  with want as (
    select distinct h.metric from card_metric_history h
     where h.card_id = p_card_id
       and (p_metric is null or p_metric = '' or h.metric = p_metric)
  ),
  -- Точка, действовавшая на начало окна: без неё график начинается с первого
  -- изменения ВНУТРИ окна, и до него линия висит в пустоте.
  edge as (
    select distinct on (h.metric) h.metric, h.taken_on, h.value
      from card_metric_history h
     where h.card_id = p_card_id
       and h.taken_on <= (now() at time zone 'utc')::date - greatest(coalesce(p_days, 365), 1)
       and (p_metric is null or p_metric = '' or h.metric = p_metric)
     order by h.metric, h.taken_on desc
  ),
  inside as (
    select h.metric, h.taken_on, h.value
      from card_metric_history h
     where h.card_id = p_card_id
       and h.taken_on > (now() at time zone 'utc')::date - greatest(coalesce(p_days, 365), 1)
       and (p_metric is null or p_metric = '' or h.metric = p_metric)
  ),
  all_points as (
    select * from edge union all select * from inside
  )
  select a.metric, a.taken_on, a.value,
         a.taken_on = max(a.taken_on) over (partition by a.metric)
    from all_points a
    join want w on w.metric = a.metric
   order by a.metric, a.taken_on;
$$;

revoke all on function public.card_metric_series(uuid, text, integer) from public;
grant execute on function public.card_metric_series(uuid, text, integer)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- ЧТО ИЗМЕНИЛОСЬ У КАРТОЧКИ за окно — одной строкой на показатель.
-- Это то, ради чего владелец и просил историю: «отслеживание резких
-- улучшений одного из показателей».
-- --------------------------------------------------------------------------
create or replace function public.card_metric_changes(
  p_card_id uuid,
  p_days    integer default 90
)
returns table (metric text, was numeric, now_value numeric, delta numeric,
               growth numeric, changed_on date)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (h.metric) h.metric, h.value, h.taken_on
      from card_metric_history h
     where h.card_id = p_card_id
     order by h.metric, h.taken_on desc
  ),
  before as (
    select distinct on (h.metric) h.metric, h.value
      from card_metric_history h
     where h.card_id = p_card_id
       and h.taken_on <= (now() at time zone 'utc')::date - greatest(coalesce(p_days, 90), 1)
     order by h.metric, h.taken_on desc
  )
  select l.metric, b.value, l.value,
         case when b.value is null or l.value is null then null
              else l.value - b.value end,
         -- Рост от нуля или от пустоты НЕ ЧИСЛО, а не «бесконечность».
         case when b.value is null or l.value is null or b.value = 0 then null
              else round(l.value / b.value, 3) end,
         l.taken_on
    from latest l
    left join before b on b.metric = l.metric
   where b.metric is null or b.value is distinct from l.value
   order by l.metric;
$$;

revoke all on function public.card_metric_changes(uuid, integer) from public;
grant execute on function public.card_metric_changes(uuid, integer)
  to anon, authenticated, service_role;
