-- ============================================================================
-- Суть новости и очищенный заголовок ролика — моделью, отдельным провайдером.
--
-- ⚠️ ЭТО НЕ ANTHROPIC_API_KEY. `digest-summary` (digest_summary.sql) делит
-- ключ с assistant-bot и пересказывает ВОСЕМЬ горячих тем по кнопке. Здесь —
-- автоматический разбор КАЖДОЙ новой заметки и КАЖДОГО нового ролика, без
-- игрока за кнопкой, поэтому объём другой и провайдер намеренно отдельный:
-- NEWS_LLM_API_KEY/NEWS_LLM_BASE_URL, секреты Supabase, OpenAI-совместимый
-- клиент. Секретов ещё может не быть — тогда конвейер работает как раньше,
-- просто без этих двух колонок.
--
-- ⚠️ СУТЬ НОВОСТИ — ИЗ description ЛЕНТЫ, А НЕ ИЗ ЗАГОЛОВКА. RSS даёт только
-- title/link/date/image; текста статьи в этом проекте никогда не было и
-- отдельно вытягивать HTML каждой статьи здесь не начато. Пересказ заголовка
-- заголовком — не суть, а перефраз, и модель либо повторит его же, либо
-- дофантазирует то, чего в источнике нет — а именно этого текст в `digest-
-- summary/index.ts` просит не делать, и просьба та же самая здесь. Поэтому
-- суть пишется, только если у заметки есть `description`; без него колонка
-- остаётся пустой, и экран показывает один заголовок, как раньше.
--
-- ⚠️ ПУСТАЯ СТРОКА ≠ NULL. NULL — «ещё не пробовали». '' — «пробовали, не
-- получилось» (нет description, модель отказалась, провайдера ещё нет).
-- Без различия конвейер пытался бы генерировать одно и то же на каждом
-- прогоне для строк, которым сгенерировать нечего, — те же деньги, тот же
-- результат. Экран трактует обе как «показать сырое», разница только для
-- конвейера: не пробовать снова то, что уже пробовали.
-- ============================================================================

alter table public.news_items
  add column if not exists summary_short text;

alter table public.goal_clips
  add column if not exists title_generated text;

-- ⚠️ БЕЗ ЭТОГО КАЖДЫЙ PATCH ПАДАЛ 403 В ПРОДЕ. `insert()` уже писал сюда
-- через INSERT ... on_conflict=ignore-duplicates, но `patchByKey()` в
-- football-digest/index.ts кладёт суть и заголовок отдельным PATCH ПОСЛЕ
-- вставки — а UPDATE service_role не выдавался никогда, потому что раньше
-- конвейер строки не обновлял, только вставлял. Найдено первым же боевым
-- прогоном v24: вставка проходила, PATCH — нет, summary_short/title_generated
-- молча оставались NULL.
grant update on public.news_items to service_role;
grant update on public.goal_clips to service_role;

comment on column public.news_items.summary_short is
  'Краткая суть заметки языковой моделью, на языке самой заметки. NULL — не '
  'пробовали (нет description в ленте или провайдер не настроен); '''' — '
  'пробовали, не вышло. Экран в обоих случаях показывает только заголовок.';

comment on column public.goal_clips.title_generated is
  'Очищенный заголовок ролика языковой моделью — без CAPS LOCK и кликбейта. '
  'NULL — ещё не пробовали; '''' — пробовали, не вышло. Сырой title рядом '
  'остаётся всегда: экран берёт сгенерированный только когда он не пуст.';

-- ---------------------------------------------------------------------------
-- digest_news — то же самое плюс summary_short.
--
-- create or replace не умеет менять returns table(...): нужен drop.
-- ---------------------------------------------------------------------------
drop function if exists public.digest_news(text, int);

create function digest_news(p_lang text default 'en', p_limit int default 30)
returns table (
  title text,
  url text,
  source text,
  lang text,
  published_at timestamptz,
  image_url text,
  loudness int,
  summary_short text
)
language sql
stable
security definer
set search_path = public
as $$
  with fresh as (
    select n.*, digest_tokens(n.title) as toks
    from news_items n
    where n.published_at > now() - interval '24 hours'
      and n.lang in (p_lang, 'en')
      and not non_football_url(n.url)
  ),
  scored as (
    select
      f.title, f.url, f.source, f.lang, f.published_at, f.image_url,
      f.summary_short,
      (
        select count(distinct o.source)::int
        from fresh o
        where cardinality(array(select unnest(o.toks) intersect select unnest(f.toks))) >= 3
      ) as loudness
    from fresh f
  )
  select title, url, source, lang, published_at, image_url, loudness,
         nullif(summary_short, '')
  from scored
  order by loudness desc, published_at desc
  limit greatest(1, least(p_limit, 60));
$$;

revoke all on function digest_news(text, int) from public;
grant execute on function digest_news(text, int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- digest_goals, digest_weekend_goals, digest_week_goals — плюс title_generated.
-- ---------------------------------------------------------------------------
drop function if exists public.digest_goals(int);

create function digest_goals(p_limit int default 20)
returns table (
  video_id text,
  title text,
  channel text,
  published_at timestamptz,
  thumb_url text,
  title_generated text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         nullif(g.title_generated, '')
  from goal_clips g
  where g.published_at > now() - interval '24 hours'
  order by g.published_at desc
  limit greatest(1, least(p_limit, 60));
$$;

revoke all on function digest_goals(int) from public;
grant execute on function digest_goals(int) to anon, authenticated, service_role;

drop function if exists public.digest_weekend_goals(int);

create function digest_weekend_goals(p_limit int default 12)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  weekend_start timestamptz, weekend_end timestamptz, title_generated text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title), b.starts_at, b.ends_at,
         nullif(g.title_generated, '')
  from goal_clips g, b
  where g.published_at >= b.starts_at and g.published_at < b.ends_at
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

revoke all on function digest_weekend_goals(int) from public;
grant execute on function digest_weekend_goals(int) to anon, authenticated, service_role;

drop function if exists public.digest_week_goals(int);

create function digest_week_goals(p_limit int default 12)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, '')
  from goal_clips g, b
  where g.published_at >= now() - interval '7 days'
    and not (g.published_at >= b.starts_at and g.published_at < b.ends_at)
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

revoke all on function digest_week_goals(int) from public;
grant execute on function digest_week_goals(int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Кандидаты для конвейера: video_id роликов без сгенерированного заголовка.
--
-- Отдельная функция, а не SELECT в Edge Function, по той же причине, что и
-- остальные RPC этого файла: правило «кому нужна генерация» должно жить в
-- одном месте, а не дублироваться между SQL и TypeScript.
-- ---------------------------------------------------------------------------
create or replace function public.goal_clips_needing_title(p_limit int default 20)
returns table (video_id text, title text, channel text)
language sql
stable
security definer
set search_path = public
as $$
  select g.video_id, g.title, g.channel
  from goal_clips g
  where g.title_generated is null
  order by g.published_at desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.goal_clips_needing_title(int) from public;
grant execute on function public.goal_clips_needing_title(int) to service_role;
