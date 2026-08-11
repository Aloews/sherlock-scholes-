-- ============================================================================
-- football_digest — заголовки дня и видео дня.
--
-- ЧТО ЭТО НА САМОМ ДЕЛЕ, потому что название легко прочитать шире, чем оно есть.
-- Здесь нет ни редакции, ни рейтинга просмотров: есть открытые RSS-ленты
-- футбольных изданий и Atom-фиды официальных каналов лиг на YouTube. Всё
-- бесплатно и без ключей — это и определило состав источников (проверено
-- запросами, а не выбрано по репутации: Reddit и Scorebat отвечают 403 всем,
-- кто не платит, и поэтому их здесь нет).
--
-- «САМЫЕ ГРОМКИЕ» — ЭТО ИЗМЕРИМАЯ ВЕЛИЧИНА, и вот какая. Ни одна RSS-лента не
-- отдаёт ни просмотров, ни репостов, так что популярность заголовка взять
-- неоткуда. Но громкость новости видна иначе: её пишут все сразу. Поэтому
-- «громкость» = сколько РАЗНЫХ изданий вышло с тем же сюжетом за сутки, и
-- считается это в digest_news() ниже, по пересечению значимых слов заголовка.
--
-- Из этого следует ограничение, которое лучше знать заранее, чем обнаружить:
-- для языка с одним источником громкость всегда равна единице, и лента просто
-- идёт по времени. Русский, английский и испанский имеют по два-три издания,
-- остальные — по одному или наследуют английский.
--
-- ЯЗЫК ХРАНИТСЯ У СТРОКИ, а не переводится. Заголовок — чужой текст, и
-- машинный перевод новости про трансфер стоит дороже, чем стоит сама новость;
-- правило девяти локалей относится к интерфейсу, а не к содержимому лент.
-- Экран просит свой язык и откатывается на английский, когда ленты нет.
-- ============================================================================

-- ─── Заголовки ──────────────────────────────────────────────────────────────

create table if not exists news_items (
  id           bigserial primary key,
  -- Язык ленты, не язык читателя. 'en' — общий откат.
  lang         text        not null,
  -- Домен издания. Он же единица счёта громкости: два заголовка одного
  -- издания об одном событии — это одно издание, а не два.
  source       text        not null,
  title        text        not null,
  -- Ссылка уникальна и служит ключом идемпотентности: конвейер ходит по
  -- расписанию и обязан быть безопасным при повторе.
  url          text        not null unique,
  published_at timestamptz not null,
  image_url    text,
  fetched_at   timestamptz not null default now()
);

create index if not exists news_items_lang_time_idx
  on news_items (lang, published_at desc);

-- ─── Видео ──────────────────────────────────────────────────────────────────

create table if not exists goal_clips (
  id           bigserial primary key,
  -- Идентификатор ролика YouTube. Уникален, и по нему же строится ссылка:
  -- хранить готовый URL значило бы хранить одно и то же дважды.
  video_id     text        not null unique,
  title        text        not null,
  channel      text        not null,
  published_at timestamptz not null,
  thumb_url    text,
  fetched_at   timestamptz not null default now()
);

create index if not exists goal_clips_time_idx on goal_clips (published_at desc);

-- ─── Права ──────────────────────────────────────────────────────────────────
--
-- ЭТО ПУБЛИЧНОЕ СОДЕРЖИМОЕ, и здесь оно отличается от fixture_odds. Тем
-- закрыт и грант, и политика — коэффициенты нельзя показывать игроку вообще.
-- Заголовок из открытой ленты показывать можно и нужно: он для того и взят.
--
-- Но политика без гранта — это таблица, которую никто не прочитает, поэтому
-- грант стоит рядом с политикой, а не «где-то в другой миграции».

alter table news_items enable row level security;
alter table goal_clips enable row level security;

drop policy if exists news_items_read on news_items;
create policy news_items_read on news_items for select to anon, authenticated using (true);

drop policy if exists goal_clips_read on goal_clips;
create policy goal_clips_read on goal_clips for select to anon, authenticated using (true);

grant select on news_items to anon, authenticated;
grant select on goal_clips to anon, authenticated;

-- Пишет только конвейер. Явно, потому что «я не выдавал права на запись» и
-- «прав на запись нет» — разные утверждения: у Supabase есть умолчания.
revoke insert, update, delete on news_items from anon, authenticated;
revoke insert, update, delete on goal_clips from anon, authenticated;

-- И ГРАНТ ПИСАТЕЛЮ — ТОЖЕ ЯВНО. Этот проект знает правило «политика без гранта
-- — таблица, которую никто не прочитает»; здесь оно повернулось другой
-- стороной: select выдан игрокам, а про service_role никто не подумал, и
-- конвейер получил `permission denied for table news_items` на первом же
-- прогоне. Снаружи это выглядело безобидно — 285 прочитанных заголовков, ноль
-- записанных, и оба числа правдоподобны.
grant insert, select, delete on news_items to service_role;
grant insert, select, delete on goal_clips to service_role;
-- bigserial — это отдельный объект с отдельными правами, и без него insert
-- падает уже после того, как строка прошла все проверки.
grant usage, select on sequence news_items_id_seq to service_role;
grant usage, select on sequence goal_clips_id_seq to service_role;

-- ─── Чтение ─────────────────────────────────────────────────────────────────

/**
 * Слова заголовка, по которым сюжеты считаются одним и тем же.
 *
 * Короткие слова выброшены не как «стоп-слова списком», а по длине: список
 * пришлось бы вести на девяти языках, а предлоги и артикли коротки во всех.
 * Четыре символа — порог, на котором «Реал», «Барса», «гол» остаются, а «и»,
 * «на», «the», «de» уходят.
 *
 * Цифры выброшены отдельно: счёт «2-1» встречается в половине заголовков дня и
 * склеивал бы несвязанные матчи в один сюжет.
 */
create or replace function digest_tokens(p_title text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct w), '{}')
  from unnest(regexp_split_to_array(lower(p_title), '[^[:alnum:]]+')) as w
  where length(w) >= 4 and w !~ '^[0-9]+$'
$$;

/**
 * Заголовки за сутки, громкие сверху.
 *
 * ГРОМКОСТЬ СЧИТАЕТСЯ ПРИ ЧТЕНИИ, а не пишется конвейером, и это осознанно:
 * сюжет становится громким постепенно: первое издание вышло в 9 утра, третье в
 * час дня, и записанное в 9 утра число к обеду было бы ложью. Строк за сутки
 * сотни, так что пересчёт стоит дешевле, чем инвалидация.
 *
 * ЯЗЫК ПЕРЕВЕШИВАЕТ ГРОМКОСТЬ, и это выяснилось на живых данных. Сначала
 * порядок был «громкость, потом язык» — и русскому читателю первым выпал
 * заголовок The Guardian: латиница склеивается по трём общим словам заметно
 * охотнее кириллицы, так что английские сюжеты набирают громкость быстрее и
 * вытесняют своих наверх. Экран «заголовки в СМИ» на языке читателя, который
 * открывается чужим языком, читается как поломка.
 *
 * Английский идёт следом, а не «если пусто»: лента может быть жива и бедна, и
 * тогда экран из трёх заголовков — тоже поломка.
 */
create or replace function digest_news(p_lang text default 'en', p_limit int default 30)
returns table (
  title text,
  url text,
  source text,
  lang text,
  published_at timestamptz,
  image_url text,
  -- Сколько РАЗНЫХ изданий вышло с этим сюжетом, включая это. 1 — никто больше.
  loudness int
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
  ),
  scored as (
    select
      f.title, f.url, f.source, f.lang, f.published_at, f.image_url,
      (
        select count(distinct o.source)::int
        from fresh o
        -- Три общих значимых слова. Два дают ложные пары на одних лишь
        -- названиях турниров, четыре не находят ничего, кроме перепечаток.
        where cardinality(array(select unnest(o.toks) intersect select unnest(f.toks))) >= 3
      ) as loudness
    from fresh f
  )
  select s.title, s.url, s.source, s.lang, s.published_at, s.image_url, s.loudness
  from scored s
  order by (s.lang = p_lang) desc, s.loudness desc, s.published_at desc
  limit greatest(1, least(p_limit, 100))
$$;

/**
 * Видео за сутки, новые сверху.
 *
 * СОРТИРОВКИ ПО «ЛУЧШЕСТИ» ЗДЕСЬ НЕТ, и это не упущение: Atom-фид YouTube не
 * отдаёт ни просмотров, ни лайков, а ходить за ними в Data API значит завести
 * ключ и квоту ради порядка в списке из десяти строк. Что есть на самом деле —
 * это то, что официальные каналы лиг опубликовали за сутки, а публикуют они
 * именно голы и моменты. Экран так и подписан.
 */
create or replace function digest_goals(p_limit int default 20)
returns table (
  video_id text,
  title text,
  channel text,
  published_at timestamptz,
  thumb_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url
  from goal_clips g
  where g.published_at > now() - interval '24 hours'
  order by g.published_at desc
  limit greatest(1, least(p_limit, 60))
$$;

-- `revoke ... from public` снимает EXECUTE и с service_role — поэтому оба
-- гранта ниже явные. Этот проект уже ронял голос ровно на этом.
revoke all on function digest_news(text, int) from public;
revoke all on function digest_goals(int) from public;
grant execute on function digest_news(text, int) to anon, authenticated, service_role;
grant execute on function digest_goals(int) to anon, authenticated, service_role;

/**
 * Выбросить всё старше трёх суток.
 *
 * Экран смотрит на 24 часа, запас — чтобы «вчера» пережило сутки без единого
 * прогона конвейера. Дальше это уже не дайджест, а архив, которого никто не
 * просил и за место под который платят.
 */
create or replace function prune_digest()
returns void
language sql
security definer
set search_path = public
as $$
  delete from news_items where published_at < now() - interval '3 days';
  delete from goal_clips where published_at < now() - interval '3 days';
$$;

revoke all on function prune_digest() from public;
grant execute on function prune_digest() to service_role;
