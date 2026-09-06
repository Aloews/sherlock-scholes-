-- Итог недели: главные события, посчитанные РАЗ В НЕДЕЛЮ и сохранённые.
--
-- ЗАЧЕМ. На главной под роликом стояла подпись «Лучший гол выходных» — слова
-- о самом ролике и больше ни о чём. Владелец: «автоматический полный итог
-- новостей футбола можно выводить раз в неделю и красиво выводить на главную
-- вместо подписи „лучший гол выходных“, само видео можно оставить».
--
-- ⚠️ СЧИТАЕТСЯ РАЗ В НЕДЕЛЮ И ХРАНИТСЯ, А НЕ СЧИТАЕТСЯ ПРИ ОТКРЫТИИ. Две
-- причины, и обе замерены:
--   * громкость считается перебором пар токенов, и на суточном окне (872
--     заметки) это уже ~1.3 с. Недельное окно — 2581 заметка, то есть работы
--     в разы больше: держать такое на главном экране нельзя;
--   * `news_items` хранит ЛЕНТУ, а не архив: на 06.09.2026 самая старая
--     заметка была от 03.09. Посчитанный задним числом «итог недели» просто
--     не из чего собрать — поэтому итог складывается вперёд, а не назад.
--
-- ⚠️ ГРОМКОСТЬ СЧИТАЕТ `digest_news`, А НЕ ЭТА ФУНКЦИЯ. Правило «сколько
-- РАЗНЫХ изданий вышло с тем же сюжетом» уже живёт там; вторая его копия
-- разошлась бы молча, и на главной оказалось бы одно «главное событие», а в
-- ленте — другое. Поэтому у `digest_news` появилось окно параметром, а не
-- второй запрос рядом.
--
-- ⚠️ МОДЕЛЬ ЗДЕСЬ НЕ ЗОВЁТСЯ ВОВСЕ. Заголовок, который написали люди в
-- редакции, — уже итог; пересказ его моделью стоит денег и добавляет риск
-- («сводка не собралась» на главном экране — это поломка на виду). Сегодня
-- этот риск не теоретический: у шлюза модели кончился баланс, и суточная
-- сводка в дайджесте красная.

-- Окно параметром. Старый вызов из приложения (p_lang + p_limit) продолжает
-- работать: третий параметр со значением по умолчанию.
--
-- ⚠️ DROP + CREATE, А НЕ CREATE OR REPLACE: добавление параметра создаёт
-- ПЕРЕГРУЗКУ, а не замену, и в базе оказались бы две копии одного тела. Обе
-- команды идут одной транзакцией.
drop function if exists public.digest_news(text, integer);

create or replace function public.digest_news(
  p_lang  text    default 'en',
  p_limit integer default 30,
  p_hours integer default 24)
returns table (
  title         text,
  url           text,
  source        text,
  lang          text,
  published_at  timestamptz,
  image_url     text,
  loudness      integer,
  summary_short text,
  lead_text     text
)
language sql
stable
security definer
set search_path = public
as $$
  with fresh as (
    select n.id, n.title, n.url, n.source, n.lang, n.published_at, n.image_url,
           n.summary_short, n.description, digest_tokens(n.title) as toks
      from news_items n
     where n.published_at > now() - make_interval(hours => greatest(1, least(p_hours, 336)))
       and n.lang in (p_lang, 'en')
       and not non_football_url(n.url)
  ),
  tok as (select distinct f.id, t from fresh f, unnest(f.toks) t),
  pairs as (
    select a.id as aid, b.id as bid
      from tok a join tok b on a.t = b.t
     group by a.id, b.id
    having count(*) >= 3
  ),
  loud as (
    select p.aid, count(distinct fb.source)::int as loudness
      from pairs p join fresh fb on fb.id = p.bid
     group by p.aid
  )
  select f.title, f.url, f.source, f.lang, f.published_at, f.image_url,
         coalesce(l.loudness, 0),
         nullif(f.summary_short, ''),
         coalesce(nullif(f.summary_short, ''), news_lead(f.description))
    from fresh f
    left join loud l on l.aid = f.id
   order by coalesce(l.loudness, 0) desc, f.published_at desc
   limit greatest(1, least(p_limit, 60));
$$;

comment on function public.digest_news(text, integer, integer) is
  'Заголовки за окно p_hours (по умолчанию сутки), по убыванию громкости. '
  'Окно ограничено двумя неделями: дальше перебор пар токенов не окупается.';

revoke all on function public.digest_news(text, integer, integer) from public;
grant execute on function public.digest_news(text, integer, integer) to anon, authenticated, service_role;

-- Итог недели, посчитанный и сложенный.
create table if not exists public.weekly_digest (
  lang         text        not null,
  -- Понедельник той недели, к которой относится итог.
  week_start   date        not null,
  -- [{title, url, source, loudness, published_at}] — по убыванию громкости.
  headlines    jsonb       not null,
  generated_at timestamptz not null default now(),
  primary key (lang, week_start)
);

comment on table public.weekly_digest is
  'Главные события недели по языкам. Считается раз в неделю (build_weekly_digest), '
  'потому что news_items — лента, а не архив: старое из неё уходит.';

alter table public.weekly_digest enable row level security;

-- Читать может кто угодно: это витрина главного экрана. Писать — только
-- служебная роль, через функцию.
drop policy if exists weekly_digest_read on public.weekly_digest;
create policy weekly_digest_read on public.weekly_digest for select using (true);

create or replace function public.build_weekly_digest(
  p_days  integer default 7,
  p_limit integer default 3)
-- ⚠️ ВЫХОДНАЯ КОЛОНКА НАЗВАНА `feed_lang`, А НЕ `lang`: в plpgsql имя
-- выходной колонки видно ВНУТРИ тела, и `insert ... (lang, ...)` спорил бы с
-- ним — Postgres так и отвечает, «column reference lang is ambiguous».
returns table(feed_lang text, stories integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_week date := date_trunc('week', now())::date;
  v_lang text;
begin
  -- Языки берутся ИЗ САМОЙ ЛЕНТЫ, а не из списка локалей. Список разошёлся бы
  -- с лентой молча: ровно так известность мерилась девятью локалями вместо
  -- языков, на которых про футбол читают.
  for v_lang in
    select distinct n.lang from news_items n
     where n.published_at > now() - make_interval(days => greatest(1, p_days))
  loop
    insert into weekly_digest (lang, week_start, headlines, generated_at)
    select v_lang, v_week,
           coalesce(jsonb_agg(jsonb_build_object(
             'title', d.title, 'url', d.url, 'source', d.source,
             'loudness', d.loudness, 'published_at', d.published_at)), '[]'::jsonb),
           now()
      from (select * from digest_news(v_lang, p_limit, p_days * 24)
             -- ⚠️ ОДНО ИЗДАНИЕ — НЕ СОБЫТИЕ НЕДЕЛИ. Громкость это и значит:
             -- о главном пишут все сразу. Без порога в итог попала бы
             -- случайная свежая заметка одного сайта.
             where loudness >= 2) d
    on conflict (lang, week_start) do update
       set headlines = excluded.headlines, generated_at = excluded.generated_at;
  end loop;

  return query
    select w.lang, jsonb_array_length(w.headlines)::integer
      from weekly_digest w where w.week_start = v_week order by 1;
end;
$function$;

comment on function public.build_weekly_digest(integer, integer) is
  'Складывает итог недели по каждому языку ленты. Идемпотентна: повторный '
  'вызов в ту же неделю переписывает свою строку.';

-- Чтение для экрана: последний собранный итог на языке читателя, с откатом на
-- английский — как и вся лента.
create or replace function public.weekly_digest(p_lang text default 'en')
returns table(title text, url text, source text, loudness integer, week_start date)
language sql
stable
security definer
set search_path = public
as $$
  with pick as (
    select w.headlines, w.week_start
      from weekly_digest w
     where w.lang = p_lang
     order by w.week_start desc
     limit 1
  ),
  -- Своего языка может не быть вовсе (лента на нём молчала неделю) — тогда
  -- английский. Пустой экран честнее чужого языка только там, где чужой язык
  -- не читается; заголовок на английском читается.
  fallback as (
    select w.headlines, w.week_start
      from weekly_digest w
     where w.lang = 'en' and not exists (select 1 from pick)
     order by w.week_start desc
     limit 1
  ),
  src as (select * from pick union all select * from fallback)
  select h->>'title', h->>'url', h->>'source',
         coalesce((h->>'loudness')::int, 0), s.week_start
    from src s, jsonb_array_elements(s.headlines) h;
$$;

comment on function public.weekly_digest(text) is
  'Главные события последней собранной недели на языке читателя, иначе на английском.';

revoke all on function public.build_weekly_digest(integer, integer) from public;
grant execute on function public.build_weekly_digest(integer, integer) to service_role;
revoke all on function public.weekly_digest(text) from public;
grant execute on function public.weekly_digest(text) to anon, authenticated, service_role;

-- Раз в неделю, в понедельник утром.
--
-- ⚠️ ПОНЕДЕЛЬНИК — НЕ ПРОИЗВОЛЬНЫЙ ДЕНЬ. Подпись обещает «события выходных»,
-- а `news_items` держит ленту, а не архив: на 06.09.2026 самая старая заметка
-- была трёхдневной. В понедельник утром окно как раз накрывает субботу,
-- воскресенье и ночь понедельника — то есть ровно то, о чём подпись.
select cron.schedule('build-weekly-digest', '0 5 * * 1',
                     $$select public.build_weekly_digest()$$);
