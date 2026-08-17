-- ============================================================================
-- Трансляции, которые правообладатель открыл САМ.
--
-- ЧТО ЭТО И ЧЕМ ОТЛИЧАЕТСЯ ОТ ТОГО, ЧТО ОТВЕРГНУТО. В шапке `broadcasts.sql`
-- записан отказ от «списка источников видео с матчами»: сотня ссылок бывает
-- одного происхождения, и это перепродажа чужого сигнала. Здесь ничего чужого
-- нет — эфир берётся с ОФИЦИАЛЬНОГО канала лиги, того же самого, с которого
-- конвейер уже качает голы (`digest_source`, kind='channel'). Если Ла Лига
-- открыла эфир у себя на канале, показать на него ссылку — не перепродажа.
--
-- ⚠️ ВЕРХНЕГО ДИВИЗИОНА ЗДЕСЬ ПОЧТИ НЕ БУДЕТ, и это свойство, а не недоделка.
-- Права на матчи АПЛ, Ла Лиги и Серии А проданы эксклюзивно по странам, и
-- бесплатного эфира у лиги не бывает. Открывают то, что не продано: резервные
-- лиги, молодёжь, женский футбол, отборочные. Замер 17.08.2026, 19:40 UTC —
-- четырнадцать официальных каналов, два эфира:
--
--   MLS      «MLS NEXT PRO: Atlanta United 2 vs Chicago Fire FC II»   ← матч
--   LALIGA   «RC DEPORTIVO vs ELCHE CF | RUEDA DE PRENSA»             ← НЕ матч
--
-- Второй случай — весь смысл `looks_like_match` ниже: в заголовке есть «vs» и
-- два клуба, а показывают пресс-конференцию. Обещать матч и открыть пресс-
-- конференцию — ровно та поломка доверия, из-за которой в `weekend_goals`
-- заведена пометка «момент».
--
-- ⚠️ ОТКУДА БЕРЁТСЯ ФАКТ ЭФИРА — НЕ ИЗ API. Идущий эфир НЕ ПОПАДАЕТ в список
-- загрузок канала: проверено на живом эфире MLS — сто роликов в
-- `UUSZbXT5TLLW_i-5W8FZpFsg`, эфира среди них нет. Значит дешёвый путь
-- (`playlistItems`, 1 единица квоты) его не найдёт, а `search.list` с
-- `eventType=live` стоит 100 единиц за канал: девять каналов раз в час — это
-- 21 600 единиц в сутки при квоте 10 000. Поэтому функция читает страницу
-- `youtube.com/channel/<id>/live` — ноль квоты, и `robots.txt` YouTube её не
-- запрещает (запрещены `/feeds/videos.xml`, `/results`, `/youtubei/`, но не
-- `/channel/` и не `/live`).
-- ============================================================================

create table if not exists public.live_streams (
  -- Идентификатор ролика YouTube. Он же ключ: один эфир — одна строка, и
  -- повторный прогон обновляет её, а не плодит.
  video_id    text primary key,

  -- Канал, на котором идёт эфир. Хранится и id, и имя: id — чтобы связать со
  -- строкой `digest_source`, имя — чтобы показать, не делая второй запрос.
  channel_id  text not null,
  channel     text not null,

  title       text not null,

  -- ⚠️ ПРИЗНАКА «ЭТО МАТЧ» ЗДЕСЬ НЕТ НАМЕРЕННО. Он считается ПРИ ЧТЕНИИ —
  -- так же, как `looks_like_goal` в weekend_goals.sql. Хранимый признак
  -- означал бы, что правило живёт в двух местах: в функции и в строках,
  -- записанных прежней версией функции. Правку предиката тогда пришлось бы
  -- сопровождать пересчётом, а забытый пересчёт выглядел бы как «предикат не
  -- работает». Строки живут два часа, считать по ним нечего.
  --
  -- Не-матчи при этом ПИШУТСЯ, а не отбрасываются конвейером: без них нельзя
  -- посмотреть, на чём предикат ошибается.

  -- Разрешил ли автор встраивание. Проверяется публичным oEmbed без ключа:
  -- 200 — можно, что угодно другое — нельзя. Сейчас на это опирается только
  -- честность записи; экран в любом случае открывает ссылку наружу.
  embeddable  boolean not null,

  -- Когда конвейер в последний раз ВИДЕЛ этот эфир живым. По нему и чистится:
  -- эфир не «заканчивается» событием, он просто перестаёт находиться.
  seen_at     timestamptz not null default now()
);

comment on table public.live_streams is
  'Идущие прямо сейчас эфиры с ОФИЦИАЛЬНЫХ каналов лиг. Не список стримов: '
  'источник — тот же канал правообладателя, с которого берутся голы.';

create index if not exists live_streams_seen_idx
  on public.live_streams (seen_at desc);

alter table public.live_streams enable row level security;

-- Политика и грант рядом: политика без гранта таблицу не открывает — Postgres
-- проверяет грант первым и отвечает 42501 до политики.
drop policy if exists live_streams_read on public.live_streams;
create policy live_streams_read on public.live_streams for select using (true);

grant select on public.live_streams to anon, authenticated;
-- ⚠️ UPDATE обязателен: конвейер пишет с resolution=merge-duplicates, и без
-- права на обновление прогон молча запишет ноль строк при полной выдаче —
-- ровно так это уже случилось с `goal_clips` (см. weekend_goals.sql).
grant select, insert, update, delete on public.live_streams to service_role;

/**
 * Похоже ли название на МАТЧ, а не на студию вокруг него.
 *
 * ⚠️ ОТРИЦАНИЕ СИЛЬНЕЕ УТВЕРЖДЕНИЯ, и это единственное измеренное правило:
 * «RC DEPORTIVO vs ELCHE CF | RUEDA DE PRENSA» содержит и «vs», и два клуба, а
 * показывают пресс-конференцию. Поэтому сначала проверяется исключение.
 *
 * Основание у списка исключений разной прочности, и врать об этом не надо:
 * «rueda de prensa» — наблюдение, остальные строки — те же слова на прочих
 * восьми языках приложения плюс очевидные форматы студии. Ошибка здесь
 * дешёвая в одну сторону (не показали идущий матч) и дорогая в другую
 * (обещали матч, открыли разговор в студии), поэтому список смещён в сторону
 * «лучше не показать».
 *
 * Признак матча — «А против Б» словом, а не тире: тире стоит в каждом втором
 * заголовке YouTube как разделитель. Бразильское « x » входит с пробелами по
 * обе стороны — без них оно поймает «Max», «Box» и любой хэштег.
 */
create or replace function public.looks_like_match(p_title text)
returns boolean language sql immutable as $$
  select lower(p_title) ~ ('(^|[^[:alnum:]])('
         || 'vs\.?|versus'
         || '|против'
         || '|contre|gegen|contro'
         || ')([^[:alnum:]]|$)')
      or lower(p_title) ~ '[[:alnum:]] x [[:alnum:]]'
$$;

create or replace function public.is_studio_talk(p_title text)
returns boolean language sql immutable as $$
  select lower(p_title) ~ (
         -- Пресс-конференция на девяти языках приложения.
         'rueda de prensa|press conference|conferenza stampa'
      || '|pressekonferenz|conf[ée]rence de presse|coletiva'
      || '|пресс-конференц|기자회견|記者会見|新闻发布会|مؤتمر صحفي'
         -- Студия, превью, разбор — не матч, даже если названы двумя клубами.
      || '|pre-?match|preview|post-?match|matchday live|watch ?along'
      || '|podcast|analysis|an[áa]lisis|reaction|обзор|превью|разбор'
         -- Жеребьёвка называет два клуба чаще любого матча.
      || '|draw show|sorteo|sorteggio|жеребьёвк|жеребьевк'
         -- ⚠️ ПОВТОР В ПЕТЛЕ — НЕ ИДУЩИЙ МАТЧ, и здесь я сам сначала ошибся:
         -- «Match Highlights: Inter vs Milan» проходило как матч, потому что в
         -- заголовке два клуба и «vs». Но сюда попадают только каналы, которые
         -- УЖЕ в эфире, и «обзор» в эфире значит крутящуюся нарезку. Показать
         -- её под надписью «идёт сейчас» — то же враньё, что пресс-конференция.
      || '|highlights|resumen|resumo|r[ée]sum[ée]|melhores momentos'
      || '|match replay|full match replay|relive|classic match'
  )
$$;

/**
 * Идущие сейчас эфиры — только матчи, свежие сверху.
 *
 * ОКНО В ЧАС, а не «всё, что в таблице». Конвейер ходит раз в десять минут и
 * удаляет то, чего больше не видит, но между падением конвейера и чисткой
 * экран показывал бы вчерашний эфир как идущий. Час — это шесть пропущенных
 * прогонов подряд: столько конвейер не молчит, а если молчит, то честнее
 * пустой раздел, чем уверенное «идёт сейчас» под завершившимся матчем.
 */
create or replace function public.digest_live_matches(p_limit integer default 8)
returns table (
  video_id   text,
  channel    text,
  title      text,
  embeddable boolean,
  seen_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.video_id, l.channel, l.title, l.embeddable, l.seen_at
  from public.live_streams l
  where public.looks_like_match(l.title)
    and not public.is_studio_talk(l.title)
    and l.seen_at > now() - interval '1 hour'
  order by l.seen_at desc, l.channel
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

revoke all on function public.looks_like_match(text) from public;
revoke all on function public.is_studio_talk(text) from public;
revoke all on function public.digest_live_matches(integer) from public;
grant execute on function public.looks_like_match(text) to anon, authenticated, service_role;
grant execute on function public.is_studio_talk(text) to anon, authenticated, service_role;
grant execute on function public.digest_live_matches(integer) to anon, authenticated, service_role;

-- Эфир, которого конвейер не видит два часа, удаляется. Не час: чистка должна
-- пережить один пропущенный прогон, иначе она соревнуется с окном чтения выше.
create or replace function public.prune_live_streams()
returns void language sql security definer set search_path = public as $$
  delete from public.live_streams where seen_at < now() - interval '2 hours';
$$;
revoke all on function public.prune_live_streams() from public;
grant execute on function public.prune_live_streams() to service_role;
