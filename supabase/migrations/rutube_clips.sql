-- ============================================================================
-- Ролики не только с YouTube: адрес просмотра переезжает в строку.
--
-- ЗАЧЕМ. В `goal_clips` лежал только `video_id`, а ссылка собиралась в
-- клиенте как `youtube.com/watch?v=<id>`. Пока источник был один, это было
-- честно и экономно. Владелец прислал три адреса с обзорами туров РПЛ, и
-- ровно здесь допущение ломается: у ролика Rutube нет идентификатора YouTube,
-- и собрать из него ссылку на YouTube значит увести читателя на чужой ролик
-- или в никуда.
--
-- ЧТО ИЗМЕРЕНО ПО ТРЁМ ПРИСЛАННЫМ АДРЕСАМ (08.09.2026, из контейнера агента):
--
--   1. rutube.ru/tags/video/8810/ — тег ЖИВ, но МЁРТВ по содержимому: три
--      ролика, последний за 04.08.2025. Год назад. Брать нечего.
--      Зато его ролики указывают на канал-владелец — «Альфа-Банк Российская
--      Премьер-Лига», person 24772178, — и вот он живой: 20 роликов на
--      странице, свежие за сегодня («Обзор матча „Динамо“ – „Спартак“»,
--      «Все голы 07.09.2026 | 7 тур»). Поэтому источником заведён КАНАЛ, а не
--      тег: то же правило, что и для YouTube («для канала — ИДЕНТИФИКАТОР»),
--      и по той же причине — тег курирует кто-то другой и в любой момент
--      бросает, а канал ведёт сам правообладатель.
--
--   2. premierliga.ru/video/?category=new — НЕДОСТУПЕН, и дважды.
--      Во-первых, robots.txt сайта запрещает `Disallow: /*?` — то есть ЛЮБОЙ
--      адрес с запросом, и присланный в том числе. Во-вторых, сервер `ycalb`
--      (Yandex Smart Web Security) отдаёт 307 на `?_ycch=1`, а следом 302 на
--      `/tmgrdfrend/showcaptchafast` — капча, бесконечный цикл редиректов даже
--      с cookie-банкой. Оба препятствия самостоятельны: снимут капчу —
--      останется запрет в robots.
--      Потери нет: те же обзоры РПЛ выкладывает её собственный канал на
--      Rutube, то есть источник тот же, только доступный.
--
--   3. okko.sport/sport_collection/reviews-of-the-day-dynamic — НЕДОСТУПЕН.
--      Отдаёт 200 и HTML с `js-challenge-loader` от servicepipe.tech: разбор
--      требует исполнения их скрипта. Под защитой ВЕСЬ домен, включая
--      robots.txt — то есть даже спросить разрешения нечем. Плюс это платная
--      подписка, и её содержимое не наше, чтобы его перекладывать.
--
-- ЧТО ЭТО ЗНАЧИТ ДЛЯ АРАБСКИХ ЛИГ. Их владелец видел на Okko, а Okko закрыт.
-- Готового проверенного канала-правообладателя на них тут нет, и заводить
-- непроверенный нельзя: `@SPL` на YouTube — канал про УХОД ЗА БАССЕЙНАМИ
-- (проверено 08.09.2026, `<title>Swimming Pool Tips, Reviews & How To`), то
-- есть ровно та же ловушка, что уже записана строкой `EFL` в этой таблице.
-- Клубные каналы «Аль-Хиляль» и «Ан-Наср» в таблице есть и выключены — это
-- ближайший рычаг, но он про клубы, а не про лигу, и включать его вслепую
-- значит повторить ошибку.
-- ============================================================================

-- ─── Адрес просмотра ────────────────────────────────────────────────────────
--
-- NULL — это «YouTube, как раньше»: столбец добавляется к тысячам уже лежащих
-- строк, и заполнять их задним числом нечем и незачем. Правило подстановки
-- живёт в одной функции ниже, а не в шести местах и не в клиенте.
alter table goal_clips add column if not exists watch_url text;

comment on column goal_clips.watch_url is
  'Полный адрес ролика, если он не на YouTube. NULL — значит YouTube, ссылка собирается из video_id.';

/**
 * Ссылка на ролик — ОДНИМ ПРАВИЛОМ НА ВСЮ БАЗУ.
 *
 * Шесть RPC отдают ролики, и подстановку «нет адреса — значит YouTube» каждая
 * из них должна делать одинаково. Скопировать coalesce шесть раз — это шесть
 * мест, где следующий источник забудут учесть в одном, и разойдутся они молча:
 * экран покажет карточку, ссылка уведёт не туда, и ошибка будет видна только
 * по нажатию.
 */
create or replace function clip_watch_url(p_video_id text, p_watch_url text)
returns text language sql immutable as $$
  select coalesce(nullif(p_watch_url, ''), 'https://www.youtube.com/watch?v=' || p_video_id)
$$;

revoke all on function clip_watch_url(text, text) from public;
grant execute on function clip_watch_url(text, text) to anon, authenticated, service_role;

-- ─── Источник вида «канал Rutube» ───────────────────────────────────────────
--
-- Ключа не требует: у Rutube открытый JSON без авторизации. Под
-- `User-agent: *` его robots.txt закрывает `/api/abtests/`, `/api/metainfo/tv/`
-- и `/api/meerkat/page/` — но НЕ `/api/video/person/`. Запрет на `/api/`
-- целиком стоит только в секции Yandex, и он не наш.
--
-- ⚠️ ЗАПРЕЩЕНЫ ПАРАМЕТРЫ, А НЕ ПУТЬ: `Disallow: /*limit=*` и `Disallow: *page=*`
-- в секции `*`. Поэтому функция ходит на ГОЛЫЙ адрес канала без запроса —
-- отдаётся первая страница, 20 роликов, чего с запасом хватает при опросе раз
-- в десять минут. Захочется больше — это НЕ повод дописать `?page=2`.
alter table digest_source drop constraint if exists digest_source_kind_check;
alter table digest_source add constraint digest_source_kind_check
  check (kind in ('feed', 'channel', 'espn_news', 'live', 'rutube'));

insert into digest_source (kind, name, ref, lang, needs_key, enabled, note, poll_group)
values (
  'rutube', 'Альфа-Банк РПЛ', '24772178', null, false, true,
  'rutube.ru/video/person/24772178 — канал самой лиги. Замер 08.09.2026: 20 роликов, свежие за сегодня. Ключа не требует.',
  0
)
on conflict (kind, ref) do update
  set enabled = true, name = excluded.name, note = excluded.note, poll_group = excluded.poll_group;

-- Снятые остаются здесь с причиной — по правилу в шапке digest_sources.sql.
insert into digest_source (kind, name, ref, lang, needs_key, enabled, note)
values
  ('feed', 'РПЛ (сайт)', 'https://premierliga.ru/video/', 'ru', false, false,
   'Капча Yandex SmartCaptcha: 307 на ?_ycch=1, затем 302 на /tmgrdfrend/showcaptchafast, цикл не кончается. Сверх того robots.txt запрещает /*? — присланный адрес с ?category=new закрыт им напрямую. Те же обзоры есть на канале лиги в Rutube.'),
  ('feed', 'Okko Спорт', 'https://okko.sport/sport_collection/reviews-of-the-day-dynamic', 'ru', false, false,
   'Защита servicepipe.tech: 200 с js-challenge-loader вместо содержимого, под защитой весь домен вместе с robots.txt. Плюс платная подписка — содержимое не наше.')
on conflict (kind, ref) do update set enabled = false, note = excluded.note;

-- ─── Шесть RPC получают адрес ───────────────────────────────────────────────
--
-- ⚠️ DROP ПЕРЕД CREATE обязателен: меняется список столбцов `returns table`, а
-- `create or replace` на это отвечает 42P13 «cannot change return type».

drop function if exists digest_goals(integer);
create or replace function digest_goals(p_limit int default 20)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, title_generated text, watch_url text
)
language sql stable security definer set search_path = public as $$
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         nullif(g.title_generated, ''), clip_watch_url(g.video_id, g.watch_url)
  from goal_clips g
  where g.published_at > now() - interval '24 hours'
  order by g.published_at desc
  limit greatest(1, least(p_limit, 60));
$$;

drop function if exists digest_recent_goals(integer, integer);
create or replace function digest_recent_goals(p_days int default 3, p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  window_start timestamptz, window_end timestamptz, title_generated text,
  watch_url text
)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select now() - make_interval(days => greatest(1, least(p_days, 7))) as starts_at,
           now() as ends_at
  ),
  win as (
    select g.*, looks_like_goal(g.title) as goal,
           (extract(epoch from now() - g.published_at) / 86400)::int as days_ago
      from goal_clips g, bounds b
     where g.published_at >= b.starts_at
  ),
  ranked as (
    select w.*,
           row_number() over (partition by w.days_ago, w.goal order by w.views desc) as in_day
      from win w
  )
  select r.video_id, r.title, r.channel, r.published_at, r.thumb_url,
         r.views, r.likes, r.goal,
         b.starts_at, b.ends_at, nullif(r.title_generated, ''),
         clip_watch_url(r.video_id, r.watch_url)
    from ranked r, bounds b
   order by r.goal desc, r.in_day, r.views desc
   limit greatest(1, least(p_limit, 40))
$$;

drop function if exists digest_earlier_goals(integer, integer);
create or replace function digest_earlier_goals(p_days int default 3, p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text, watch_url text
)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select now() - make_interval(days => greatest(1, least(p_days, 7))) as starts_at
  )
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, ''), clip_watch_url(g.video_id, g.watch_url)
    from goal_clips g, bounds b
   where g.published_at >= now() - interval '7 days'
     and g.published_at < b.starts_at
   order by looks_like_goal(g.title) desc, g.views desc
   limit greatest(1, least(p_limit, 40))
$$;

drop function if exists digest_weekend_goals(integer);
create or replace function digest_weekend_goals(p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  weekend_start timestamptz, weekend_end timestamptz, title_generated text,
  watch_url text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title), b.starts_at, b.ends_at,
         nullif(g.title_generated, ''), clip_watch_url(g.video_id, g.watch_url)
  from goal_clips g, b
  where g.published_at >= b.starts_at and g.published_at < b.ends_at
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

drop function if exists digest_week_goals(integer);
create or replace function digest_week_goals(p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text, watch_url text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, ''), clip_watch_url(g.video_id, g.watch_url)
  from goal_clips g, b
  where g.published_at >= now() - interval '7 days'
    and not (g.published_at >= b.starts_at and g.published_at < b.ends_at)
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

drop function if exists player_clips(uuid, integer);
create or replace function player_clips(p_card_id uuid, p_limit int default 6)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, watch_url text
)
language sql stable as $$
  with me as (
    select public.player_surname_stem(c.name_en) as stem
    from public.cards c where c.id = p_card_id
  )
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         public.clip_watch_url(g.video_id, g.watch_url)
  from public.goal_clips g, me
  where me.stem is not null
    and exists (
      select 1 from unnest(public.digest_tokens(g.title)) t
      where left(t, 5) = me.stem
    )
  order by g.published_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

revoke all on function digest_goals(int) from public;
revoke all on function digest_recent_goals(int, int) from public;
revoke all on function digest_earlier_goals(int, int) from public;
revoke all on function digest_weekend_goals(int) from public;
revoke all on function digest_week_goals(int) from public;
revoke all on function player_clips(uuid, int) from public;

grant execute on function digest_goals(int) to anon, authenticated, service_role;
grant execute on function digest_recent_goals(int, int) to anon, authenticated, service_role;
grant execute on function digest_earlier_goals(int, int) to anon, authenticated, service_role;
grant execute on function digest_weekend_goals(int) to anon, authenticated, service_role;
grant execute on function digest_week_goals(int) to anon, authenticated, service_role;
grant execute on function player_clips(uuid, int) to anon, authenticated, service_role;
