-- ============================================================================
-- Суть заметки — из её ТЕКСТА, а не из заголовка.
--
-- ЧТО ВЫЯСНИЛОСЬ, ПРЕЖДЕ ЧЕМ ЧТО-ТО ПИСАТЬ. Механизм «сути» есть с самого
-- начала, и читает он именно текст: `football-digest` берёт из RSS
-- `description` (или `content:encoded`), отбирает заметки длиннее 40 символов
-- и отдаёт модели `<article>заголовок + текст</article>`
-- (generateNewsSummaries). То есть «пересказывать текст, а не заголовок» в
-- коде УЖЕ решено, и переписывать это было бы работой впустую.
--
-- ⚠️ И НИ ОДНА ЗАМЕТКА СУТИ НЕ ИМЕЕТ. Замер 30.08.2026 на боевой базе: за
-- сутки 881 свежая заметка, `summary_short` не пуст у НУЛЯ из них. Причина —
-- первая же строка той самой функции:
--
--     if (!llmClient || !NEWS_LLM_MODEL) return out;
--
-- Секреты NEWS_LLM_* не заданы, и пересказ молча не запускается ни разу.
-- ЭТО НАСТРОЙКА, А НЕ КОД: задать переменные окружения функции — и суть
-- появится сама, без единой правки здесь.
--
-- ⚠️ НО ТЕКСТ ЗАМЕТКИ ВЫБРАСЫВАЛСЯ И БЕЗ ВСЯКОЙ МОДЕЛИ. `description` не был
-- колонкой news_items, и функция снимала его прямо перед вставкой. То есть
-- даже первые две строки самой заметки — те, что RSS отдаёт даром и на всех
-- языках сразу, — до экрана не доезжали никогда. Колонка заводится здесь,
-- и лента может показать хотя бы собственное начало статьи, пока модель не
-- настроена.
--
-- `lead_text` — ОДНО поле для экрана, чтобы клиенты не расходились в том, что
-- считать сутью: пересказ модели, если он есть, иначе начало статьи. Выбор
-- живёт в SQL, а не в трёх компонентах.
--
-- ⚠️ ДО ДЕПЛОЯ football-digest КОЛОНКА ОСТАЁТСЯ ПУСТОЙ, и это ожидаемо:
-- заполняет её функция, а в проде пока прежняя версия. Пустая колонка ничего
-- не ломает — `lead_text` тогда равен NULL, ровно как `summary_short` сегодня,
-- и лента выглядит как выглядела. Строка появится в тот день, когда функцию
-- выкатят.
-- ============================================================================

alter table public.news_items add column if not exists description text;

comment on column public.news_items.description is
  'Текст заметки из RSS (description / content:encoded), без тегов. Источник '
  'для summary_short и запасной вариант для него же. Заполняет football-digest.';

-- Сколько символов начала статьи показываем, когда пересказа нет. 180 —
-- две-три строки на телефоне: меньше — не суть, больше — уже статья.
create or replace function public.news_lead_len()
returns integer language sql immutable as $$ select 180; $$;

-- ---------------------------------------------------------------------------
-- Начало статьи, обрезанное ПО ГРАНИЦЕ СЛОВА.
--
-- Обрывок на середине слова («Арсенал объявил о подпи…») читается как сбой
-- вёрстки, а не как сокращение.
--
-- ⚠️ ОДНО ДЛИННОЕ СЛОВО БЕЗ ПРОБЕЛОВ НЕ ПРЕВРАЩАЕТСЯ В ПУСТОТУ. Если в первых
-- 180 символах пробела нет вовсе, regexp не срабатывает и строка остаётся как
-- есть. Проверено: news_lead(repeat('a',300)) возвращает 181 символ, а не
-- NULL и не ''. Наивное «отрезать по последнему пробелу» вернуло бы пустую
-- строку, и заметка потеряла бы суть молча.
-- ---------------------------------------------------------------------------
create or replace function public.news_lead(p_text text)
returns text
language sql immutable
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when length(btrim(p_text)) <= news_lead_len() then btrim(p_text)
    else regexp_replace(left(btrim(p_text), news_lead_len()), '\s+\S*$', '') || '…'
  end;
$$;

-- Форма ответа расширяется на колонку, поэтому сначала drop: `create or
-- replace` не меняет тип возврата.
--
-- ⚠️ ДРОПАТЬ ФУНКЦИЮ НА ОБЩЕЙ БАЗЕ ОПАСНО, и в этот же день это уже стоило
-- работы: две сессии одновременно пересоздали prediction_leaderboard, и
-- вторая молча съела колонки первой (см. prediction_accuracy_keep_outcome_
-- rate.sql). Здесь форма только РАСШИРЯЕТСЯ — старые колонки на месте, — так
-- что клиент, который про lead_text не знает, продолжает работать.
drop function if exists public.digest_news(text, integer);

create or replace function public.digest_news(p_lang text default 'en', p_limit integer default 30)
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
     where n.published_at > now() - interval '24 hours'
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
         -- Пересказ модели, если он есть; иначе начало самой статьи.
         coalesce(nullif(f.summary_short, ''), news_lead(f.description))
    from fresh f
    left join loud l on l.aid = f.id
   order by coalesce(l.loudness, 0) desc, f.published_at desc
   limit greatest(1, least(p_limit, 60));
$$;

revoke all on function public.news_lead_len()            from public;
revoke all on function public.news_lead(text)            from public;
revoke all on function public.digest_news(text, integer) from public;
grant execute on function public.news_lead_len()            to anon, authenticated, service_role;
grant execute on function public.news_lead(text)            to anon, authenticated, service_role;
grant execute on function public.digest_news(text, integer) to anon, authenticated, service_role;

comment on function public.digest_news(text, integer) is
  'Лента заголовков, порядок по громкости сюжета. Громкость — соединение по '
  'токенам: 1823 мс -> 124 мс в среднем, вывод совпадает построчно '
  '(digest_news_token_join). lead_text — суть для экрана: пересказ модели, '
  'иначе начало статьи.';
