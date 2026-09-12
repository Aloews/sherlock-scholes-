-- ============================================================================
-- У роликов появляется язык, и вместе с ним — раздел «на вашем языке».
--
-- ЗАЧЕМ, И ПОЧЕМУ НЕ ПРАВКОЙ РАНЖИРОВАНИЯ. Канал РПЛ подключён и пишет в
-- `goal_clips` (rutube_clips.sql), но на экран не попадает НИ ОДИН его ролик.
-- Замер 08.09.2026, все четыре RPC роликов: `digest_recent_goals(3,40)` —
-- 40 строк, из них Rutube 0; `digest_goals(60)` — 0; `digest_week_goals(40)` —
-- 0; `digest_weekend_goals(40)` — 0.
--
-- Причина не в ошибке, а в мере: у обзора тура РПЛ 749 просмотров, у ролика
-- «Арсенала» — 2 451 505. Это не «РПЛ хуже», это разные аудитории, и любой
-- общий топ по просмотрам РПЛ хоронит навсегда.
--
-- Правку самого ранжирования я пробовал и ОТВЁРГ по замеру:
--
--   * добавить канал в partition — спред стал лучше (26 каналов вместо 17),
--     но РПЛ по-прежнему НЕ ПОПАЛА: внутри первого круга строки всё равно
--     сортируются по абсолютным просмотрам, и 749 стоит последним;
--   * делить просмотры на медиану канала — РПЛ снова не попала, зато у MLS
--     вылезло отношение 1511: у канала, который почти ничего не выкладывает,
--     медиана равна единице, и любой средний ролик становится «в полторы
--     тысячи раз выше обычного». Мера, которую ломает один тихий канал, —
--     это не мера.
--
-- Поэтому общий топ остаётся КАК БЫЛ. Он честно отвечает на вопрос «что
-- посмотрел весь мир», и РПЛ в нём проигрывает по существу, а не по ошибке.
--
-- А нужное владельцу — «обзоры туров РПЛ видно» — решается тем же приёмом,
-- который в этом проекте УЖЕ применён к новостям: у ленты есть язык, и
-- `digest_news(p_lang)` отдаёт читателю его язык. У роликов языка не было
-- вовсе. Теперь есть, и раздел на языке читателя стоит рядом с общим топом,
-- не смешиваясь с ним и ничего в нём не меняя.
--
-- ⚠️ NULL — ЭТО НЕ «АНГЛИЙСКИЙ», А «ЯЗЫК НЕ ЗАДАН». У семнадцати каналов
-- YouTube языка нет и не будет проставлено задним числом: «Серия А» пишет
-- заголовки по-итальянски, LALIGA по-испански, а UEFA как придётся. Врать про
-- них ради заполненности столбца — значит показать испанцу итальянский ролик
-- как «на вашем языке». Пусто честнее.
-- ============================================================================

alter table goal_clips add column if not exists lang text;

comment on column goal_clips.lang is
  'Язык ролика, если источник его знает. NULL — не задан; это НЕ английский.';

create index if not exists goal_clips_lang_time_idx
  on goal_clips (lang, published_at desc) where lang is not null;

-- Канал РПЛ — русский. Проставляется здесь и, начиная со следующего прогона,
-- самим конвейером из `digest_source.lang`.
update digest_source set lang = 'ru' where kind = 'rutube' and ref = '24772178';

-- Уже записанным двадцати строкам язык проставляется разово: конвейер
-- переписывает строку целиком только при следующем появлении ролика в выдаче
-- канала, а он оттуда уходит по мере выхода новых.
update goal_clips set lang = 'ru'
 where lang is null and watch_url like 'https://rutube.ru/video/%';

/**
 * Ролики на языке читателя — ОТДЕЛЬНЫМ СПИСКОМ, ПО ВРЕМЕНИ.
 *
 * Не по просмотрам, и это главное решение здесь. Внутри одного языка каналов
 * пока один, и «лучшее» из одного канала — это просто его лента; а вот
 * «свежее» отвечает на настоящий вопрос читателя: вышел ли обзор его тура.
 * Когда языков и каналов станет больше, сортировку можно будет обсуждать
 * заново — на данных, а не заранее.
 *
 * Окно семь суток, а не трое: тур идёт неделю, и обзор среды к воскресенью не
 * должен исчезать. Дольше и не получится — `prune_digest` держит десять дней.
 */
create or replace function digest_local_goals(p_lang text, p_limit int default 12)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text, watch_url text
)
language sql stable security definer set search_path = public as $$
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, ''), clip_watch_url(g.video_id, g.watch_url)
    from goal_clips g
   where g.lang = nullif(p_lang, '')
     and g.published_at >= now() - interval '7 days'
   order by g.published_at desc
   limit greatest(1, least(coalesce(p_limit, 12), 40))
$$;

revoke all on function digest_local_goals(text, int) from public;
grant execute on function digest_local_goals(text, int) to anon, authenticated, service_role;

-- ─── Кто проставляет язык ───────────────────────────────────────────────────
--
-- ⚠️ БАЗА, А НЕ СБОРЩИК, И ЭТО РЕШЕНИЕ ПО ПРАВИЛУ САМОГО РЕПОЗИТОРИЯ.
-- Сборщик знает язык источника напрямую — казалось бы, ему и писать. Но тогда
-- смена языка источника потребовала бы ВЫКЛАДКИ Edge Function, а именно от
-- этого проект и уходил, когда выносил список источников в таблицу: «добавить
-- ленту — это INSERT, снять — enabled = false, и деплой для этого не нужен»
-- (шапка digest_sources.sql). Язык — такое же свойство источника, как адрес.
--
-- Связь идёт по ИМЕНИ, и это не хрупкость: `goal_clips.channel` сборщик
-- заполняет ровно из `digest_source.name`, а менять `name` задним числом та же
-- шапка уже запрещает — «уже записанные строки останутся со старым именем».
--
-- ⚠️ ОДНОЗНАЧНОСТЬ ПРОВЕРЯЕТСЯ, А НЕ ПРЕДПОЛАГАЕТСЯ. Если два источника с
-- одним именем объявят РАЗНЫЙ язык, угадывать нельзя: строка останется без
-- языка и просто не попадёт в раздел. Молчание здесь дешевле выдумки —
-- показать испанцу итальянский ролик как «на вашем языке» хуже, чем не
-- показать ничего.
create or replace function fill_clip_languages()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with known as (
    select s.name, min(s.lang) as lang
      from digest_source s
     where s.lang is not null and s.lang <> ''
     group by s.name
    having count(distinct s.lang) = 1
  )
  update goal_clips g
     set lang = k.lang
    from known k
   where g.channel = k.name
     and g.lang is distinct from k.lang;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function fill_clip_languages() from public;
grant execute on function fill_clip_languages() to service_role;

-- Зовётся тем же шагом, что уже идёт КАЖДЫЙ прогон конвейера, — чтобы не
-- заводить второе расписание ради одного столбца.
create or replace function prune_digest()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from news_items where published_at < now() - interval '3 days';
  delete from goal_clips where published_at < now() - interval '10 days';
  perform fill_clip_languages();
end;
$$;

revoke all on function prune_digest() from public;
grant execute on function prune_digest() to service_role;
