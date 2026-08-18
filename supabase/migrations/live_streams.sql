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

  -- ⚠️ КОЛОНКИ `embeddable` ЗДЕСЬ БОЛЬШЕ НЕТ, и это исправление, а не упрощение.
  -- Она была заведена как «разрешил ли автор встраивание», но по построению
  -- конвейера могла быть ТОЛЬКО ИСТИНОЙ: oEmbed отвечает заголовком либо не
  -- отвечает, а без заголовка строка не пишется вовсе — разбирать в ней нечего.
  -- Замер это подтвердил: два ряда в таблице, оба true, других значений
  -- появиться не могло. Колонка обещала различение, которого источник не даёт,
  -- и ни один экран её не читал.
  --
  -- Различить «нельзя встраивать» и «ролика нет» можно только взяв заголовок
  -- со страницы, а не из oEmbed. Это отдельная работа, и делать её незачем,
  -- пока приложение всё равно открывает ссылку СНАРУЖИ: мини-приложение живёт
  -- в WebView, и встроенный плеер здесь не рассматривался.

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
 * заголовке YouTube как разделитель.
 *
 * ОДИНОЧНЫЕ « x » И « v » — С ПРОБЕЛАМИ И БУКВАМИ ПО ОБЕ СТОРОНЫ. Без этого
 * они ловят «Max», «Box» и любой хэштег. С этим — берут два способа назвать
 * матч, которыми пользуются сами лиги: бразильское «Flamengo x Palmeiras» и
 * британское «Häcken v Hammarby». Второе я сначала отверг как рискованное, и
 * это было ошибкой: обход вкладки трансляций УЕФА нашёл им же названный финал
 * женского Кубка Европы, который предикат молча пропускал.
 *
 * ⚠️ ИЗВЕСТНЫЙ ПРЕДЕЛ « x », ИЗМЕРЕННЫЙ, А НЕ ПРЕДПОЛОЖЕННЫЙ. Тем же знаком
 * подписывают совместные проекты: «Ligue 1 Uber Eats x EA» — не матч, а
 * реклама. Отличить «бренд x бренд» от «клуб x клуб» разбором заголовка
 * нельзя, и я не притворяюсь, что можно. Конкретный случай снят исключением
 * ниже; общий остаётся, и цена ему — один ложный матч на двадцать восемь
 * трансляций Ligue 1. Уберёте « x » — потеряете бразильские заголовки
 * целиком; это размен, а не недосмотр.
 */
create or replace function public.looks_like_match(p_title text)
returns boolean language sql immutable as $$
  select lower(p_title) ~ ('(^|[^[:alnum:]])('
         || 'vs\.?|versus'
         || '|против'
         || '|contre|gegen|contro'
         || ')([^[:alnum:]]|$)')
      or lower(p_title) ~ '[[:alnum:]] x [[:alnum:]]'
      or lower(p_title) ~ '[[:alnum:]] v [[:alnum:]]'
$$;

create or replace function public.is_studio_talk(p_title text)
returns boolean language sql immutable as $$
  select lower(p_title) ~ (
         -- Пресс-конференция на девяти языках приложения.
         'rueda de prensa|press conference|conferenza stampa'
      || '|pressekonferenz|conf[ée]rence de presse|coletiva'
      || '|пресс-конференц|기자회견|記者会見|新闻发布会|مؤتمر صحفي'
         -- Студия, превью, разбор — не матч, даже если названы двумя клубами.
         -- ⚠️ «previa» И «highlight» БЕЗ S — обе формы найдены обходом вкладок
         -- трансляций, а не придуманы. Через список без них проходили
         -- «🔴 RC DEPORTIVO vs ELCHE CF - PREVIA DEL PARTIDO» у Ла Лиги и
         -- «[Highlight] … Jeju vs. Anyang» у K League: то есть 8 из 30 и 24 из
         -- 72 заголовков соответственно объявлялись матчами.
      || '|pre-?match|avant-?match|previews?|previa|prévia|post-?match'
      || '|matchday live|watch ?along'
      || '|podcast|analysis|an[áa]lisis|reaction|обзор|превью|разбор'
         -- Жеребьёвка называет два клуба чаще любого матча.
      || '|draw show|sorteo|sorteggio|жеребьёвк|жеребьевк'
         -- Совместные проекты и презентации: «Ligue 1 Uber Eats x EA»,
         -- «REVEAL TEAM OF THE SEASON». Знак « x » между брендами не отличить
         -- от « x » между клубами, поэтому отсекается сам формат.
      || '|team of the season|ultimate team|fut \d|reveal'
         -- ⚠️ ПОВТОР В ПЕТЛЕ — НЕ ИДУЩИЙ МАТЧ, и здесь я сам сначала ошибся:
         -- «Match Highlights: Inter vs Milan» проходило как матч, потому что в
         -- заголовке два клуба и «vs». Но сюда попадают только каналы, которые
         -- УЖЕ в эфире, и «обзор» в эфире значит крутящуюся нарезку. Показать
         -- её под надписью «идёт сейчас» — то же враньё, что пресс-конференция.
         -- ⚠️ «ОБЗОР» НЕ ТОЛЬКО ЛАТИНИЦЕЙ. K League подписывает свои
         -- трансляции «[30분 하이라이트] … 대구 vs 충남아산», и через список из
         -- одной латиницы матчами объявлялись 22 заголовка из 72. Приложение
         -- переведено на девять языков — список исключений тоже обязан быть.
      || '|highlights?|하이라이트|ハイライト|集锦|精彩'
      || '|resumen|resumo|r[ée]sum[ée]|melhores momentos'
         -- Голое «replay», а не только «match replay»: Ligue 1 подписывает так
         -- восемь из двадцати восьми своих трансляций — «Replay | Matchday 25
         -- … PSG vs Monaco». Через список без этой формы все восемь шли
         -- матчами.
      || '|replay|relive|classic match'
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
  seen_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.video_id, l.channel, l.title, l.seen_at
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
