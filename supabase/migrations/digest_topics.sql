-- ============================================================================
-- Горячие ТЕМЫ, а не заголовки.
--
-- ЗАЧЕМ, ЕСЛИ ЕСТЬ digest_news. Та ранжирует ЗАГОЛОВКИ по громкости, и в
-- топ-10 одна история занимает три строки: «Черчесов отреагировал»,
-- «Черчесов прокомментировал», «Черчесов высказался». Это замер, а не
-- предположение — так выглядела выдача до этой функции. Читателю нужна тема
-- один раз, а не трижды.
--
-- КАК СОБИРАЕТСЯ ТЕМА. Заметки — вершины, ребро между ними есть, когда у них
-- не меньше ТРЁХ общих значимых основ. Тема — связная компонента.
--
--   * Основы даёт `digest_tokens` (первые 5 букв слов длиннее 3) — та же
--     функция, что считает громкость, чтобы «похоже» значило одно и то же в
--     обоих местах.
--   * Слова, встречающиеся больше чем в четверти заметок, выбрасываются:
--     «матч», «тренер», «после» склеивают всё со всем. Порог, а не список
--     стоп-слов — список пришлось бы вести на девяти языках.
--   * Порог в три общих основы, а не в две: на двух «Милан» + «Юнайтед»
--     превью матча сливается с отчётом о нём.
--
-- ЭТО РАБОТАЕТ ЧЕРЕЗ ЯЗЫКИ, и это главное свойство. Имена собственные пишутся
-- латиницей одинаково в es/pt/fr/en, поэтому «Enzo Fernández» собирает Marca,
-- Mundo Deportivo, Record и Foot Mercato в одну тему — четыре издания трёх
-- стран.
--
-- И ЧЕРЕЗ АЛФАВИТЫ ТОЖЕ — но так было не всегда. Здесь раньше стояло, что
-- «Torres» и «Торрес» общих основ не имеют и снять это можно только переводом
-- или словарём имён. Первое верно, второе оказалось неверно: хватило
-- транслитерации (`digest_translit`), и словарь имён как раз ПРОВАЛИЛСЯ на
-- замере — 78 ложных рёбер из 104, все на клубах. Подробности и таблица
-- замеров — в football_digest.sql.
--
-- Ценой был не порог, а ровно одно наблюдение: русская половина лент жила
-- отдельно от всех остальных, и «Арсенал» — «Манчестер Сити» шёл двумя
-- сюжетами, из которых русский стоял шестым при 227 заголовках. Теперь это
-- одна тема из девяти изданий на четырёх языках.
--
-- ГОРЯЧЕСТЬ — ЭТО ЧИСЛО РАЗНЫХ ИЗДАНИЙ, а не число заметок. Одно издание,
-- написавшее о матче сто раз (живой текст), не делает событие громким — и
-- ровно так выглядит кластер из 125 заголовков про «Родина» — «Акрон».
-- ============================================================================

create or replace function public.digest_topics(
  p_lang  text default 'ru',
  p_limit integer default 10,
  p_hours integer default 24
)
returns table (
  topic       text,
  outlets     integer,
  headlines   integer,
  langs       text[],
  sources     text[],
  url         text,
  first_seen  timestamptz,
  last_seen   timestamptz
)
language sql
stable
as $$
  with recursive recent as (
    select n.id, n.lang, n.source, n.title, n.url, n.published_at,
           public.digest_tokens(n.title) as toks
    from public.news_items n
    where n.published_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
  ),
  tok as (
    select r.id, t from recent r, unnest(r.toks) as t
  ),
  common as (
    select t from tok group by t
    having count(distinct id) > greatest(3, (select count(*) from recent) / 4)
  ),
  useful as (
    select * from tok where t not in (select t from common)
  ),
  edge as (
    select a.id as src, b.id as dst
    from useful a join useful b on a.t = b.t and a.id <> b.id
    group by a.id, b.id
    having count(*) >= 3
  ),
  -- Связные компоненты: перечисляем все достижимые корни и берём минимальный.
  -- `union`, а не `union all` — он же и завершает обход.
  reach as (
    select id as node, id as root from recent
    union
    select e.dst, r.root from reach r join edge e on e.src = r.node
  ),
  comp as (
    select node, min(root) as root from reach group by node
  )
  select
    -- Тема названа САМЫМ РАННИМ заголовком кластера: он ближе к событию, а
    -- поздние — это уже реакции на реакции.
    (array_agg(r.title order by r.published_at))[1],
    count(distinct r.source)::integer,
    count(*)::integer,
    array_agg(distinct r.lang),
    array_agg(distinct r.source),
    (array_agg(r.url order by r.published_at))[1],
    min(r.published_at),
    max(r.published_at)
  from comp c
  join recent r on r.id = c.node
  group by c.root
  order by count(distinct r.source) desc, count(*) desc, min(r.published_at) desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function public.digest_topics(text, integer, integer)
  to anon, authenticated, service_role;

-- ⚠️ ПЕРВЫЙ ЖЕ ПРОГОН ВСКРЫЛ ТРИ ДЕФЕКТА ЛЕНТ, которые до кластеризации были
-- не видны — они прятались среди трёхсот заголовков:
--   1. Record ЭКРАНИРУЕТ собственные скобки CDATA: в ленте лежит
--      «<title>&lt;![CDATA[ … ]]&gt;</title>». Настоящий CDATA снимает разбор
--      тега, а этот виден только после раскодирования сущностей — там его
--      теперь и снимают. Первый диагноз («регулярка не берёт CDATA с
--      пробелом») был неверен.
--   2. Оттуда же приходила битая кодировка: лента честно объявляет
--      ISO-8859-1 и в заголовке, и в XML-декларации, а `Response.text()` по
--      спецификации Fetch всегда читает UTF-8 и на charset не смотрит.
--   3. Живой текст матча даёт кластер в 125 заголовков от двух изданий.
--      Порядок это переживает (сортировка по числу ИЗДАНИЙ), но тема
--      называется случайной минутой матча.
-- Всё три — в football-digest, то есть чинятся деплоем, а не здесь.
