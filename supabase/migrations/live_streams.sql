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
-- ⚠️ КАНДИДАТА ДАЁТ СТРАНИЦА, А СТАТУС — API. Разделение не украшение: в нём
-- вся починка «идёт сейчас».
--
-- НАЙТИ эфир через API дорого. Идущий эфир НЕ ПОПАДАЕТ в список загрузок
-- канала: проверено на живом эфире MLS — сто роликов в
-- `UUSZbXT5TLLW_i-5W8FZpFsg`, эфира среди них нет. Значит дешёвый путь
-- (`playlistItems`, 1 единица квоты) его не найдёт, а `search.list` с
-- `eventType=live` стоит 100 единиц за канал: двенадцать каналов даже раз в
-- час — 28 800 единиц в сутки при квоте 10 000, а на десяти минутах 172 800.
-- Поэтому кандидат по-прежнему берётся со страницы
-- `youtube.com/channel/<id>/live` — ноль квоты, и `robots.txt` YouTube её не
-- запрещает (запрещены `/feeds/videos.xml`, `/results`, `/youtubei/`, но не
-- `/channel/` и не `/live`).
--
-- ⚠️ НО СТРАНИЦА НЕ ГОВОРИТ, ИДЁТ ЭФИР ИЛИ ТОЛЬКО НАЗНАЧЕН. Это замер
-- 13.09.2026, а не опасение:
--
--   вечные эфиры (Sky News, NASA, DW, Bloomberg, Lofi Girl) — `"isLiveNow":true`
--     не встречается НИ РАЗУ, а canonical вообще не указывает на ролик;
--   каналы лиг с АНОНСОМ (Concacaf, MLS) — canonical на ролик есть, и рядом
--     `"isUpcoming":true`, `"scheduledStartTime"`, `LIVE_STREAM_OFFLINE`.
--
-- То есть прежний признак ловил РОВНО ПРОТИВОПОЛОЖНОЕ обещанному. В таблице
-- лежали одни анонсы, и все восемь строк, которые экран подписывал «идёт
-- сейчас», начинались в будущем — вплоть до «Пряма трансляція матчу УПЛ-2
-- (15.09.2026)» при сегодняшнем 13.09. Владелец назвал это издевательством, и
-- он прав: человек открывал ссылку и читал «трансляция начнётся через 2 дня».
--
-- Статус спрашивается у `videos.list?part=snippet,liveStreamingDetails` —
-- ОДНА ЕДИНИЦА ЗА ВЕСЬ ПРОГОН, а не за канал: до 50 идентификаторов уходят
-- одним вызовом. 144 единицы в сутки на десятиминутном расписании при квоте
-- 10 000. Решают два поля, а не разметка:
--
--   actualStartTime есть, actualEndTime нет → ИДЁТ
--   actualStartTime нет, есть scheduledStartTime → НАЗНАЧЕН
--   actualEndTime есть → КОНЧИЛСЯ, строка удаляется сразу
--
-- ⚠️ И ЗАГОЛОВОК ТЕПЕРЬ ОТТУДА ЖЕ, а не из oEmbed: тот же ответ несёт
-- `snippet.title`, то есть двенадцать лишних запросов к YouTube ушли вместе с
-- отдельным шагом. oEmbed выбирался ради чистого текста без сущностей — JSON
-- API даёт его с тем же свойством.
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
  seen_at     timestamptz not null default now(),

  -- ⚠️ ДВА ВРЕМЕНИ, И ИМЕННО ИХ ТУТ НЕ ХВАТАЛО. `started_at` — когда эфир
  -- начался НА САМОМ ДЕЛЕ (`actualStartTime`); NULL значит «ещё не
  -- начинался». `scheduled_start_at` — на когда назначен
  -- (`scheduledStartTime`); он бывает заполнен и у идущего эфира, поэтому не
  -- отменяет первый, а дополняет.
  --
  -- Хранятся ФАКТЫ (две отметки времени), а признак «идёт» считается при
  -- чтении — тем же правилом, что и `looks_like_match` выше: `started_at is
  -- not null`. Хранить ещё и признак значило бы держать его в двух местах.
  started_at         timestamptz,
  scheduled_start_at timestamptz
);

-- Для баз, где таблица уже создана: `create table if not exists` выше их не
-- добавит. Обе строки обязаны быть — в create для чистой базы, в alter для
-- боевой.
alter table public.live_streams add column if not exists started_at timestamptz;
alter table public.live_streams add column if not exists scheduled_start_at timestamptz;

-- ⚠️ РАЗОВАЯ УБОРКА ЗА ПРЕЖНИМ КОНВЕЙЕРОМ. Строки, записанные до этой правки,
-- обеих отметок не имеют — про них попросту неизвестно, идут они или назначены,
-- и ни одна из функций чтения их теперь не отдаёт. Оставить их значит держать в
-- таблице девятнадцать строк, про которые нельзя сказать ничего. Новая строка
-- без обеих отметок появиться не может: конвейер пишет только приговорённое.
delete from public.live_streams
where started_at is null and scheduled_start_at is null;

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
      || '|draw show|stage draw|group draw|draw ceremony'
      || '|sorteo|sorteggio|жеребьёвк|жеребьевк'
         -- Совместные проекты и презентации: «Ligue 1 Uber Eats x EA»,
         -- «REVEAL TEAM OF THE SEASON». Знак « x » между брендами не отличить
         -- от « x » между клубами, поэтому отсекается сам формат.
      || '|team of the season|ultimate team|fut \d|reveal'
         -- ⚠️ КИБЕРФУТБОЛ — НАСТОЯЩИЙ МАТЧ НЕ НАСТОЯЩИХ КОМАНД. Официальный
         -- канал Indian Super League ведёт 29 трансляций из 30 под именем
         -- «eISL»: реальные клубы, реальное «vs», играют в видеоигру. Ни один
         -- признак выше это не ловит, а показать киберматч под надписью
         -- «идёт сейчас» в футбольном приложении — то же враньё.
      || '|\meisl\M|\me-?sports?\M|\me-?football\M|\me-?league\M'
      || '|ea sports fc|ea fc \d|fifa \d\d|konami'
         -- ⚠️ СОПРОВОДИТЕЛЬНЫЙ СТРИМ — НЕ МАТЧ. Экстракляса ведёт их под
         -- меткой «LIVE IRL», и в тех же заголовках прямо написано «Mecz w
         -- Canal+Sport 3» — то есть сам матч идёт на платном ТВ, а на YouTube
         -- человек его комментирует. Предикат отсекал их случайно, по тире;
         -- случайность — не основание.
      || '|\mirl\M|fan ?cam|reakcja|komentarz'
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
 * Идущие сейчас эфиры — только матчи, которые УЖЕ НАЧАЛИСЬ.
 *
 * ⚠️ `started_at is not null` — ЭТО И ЕСТЬ ПОЧИНКА. Прежде условия было два
 * (матч по заголовку и свежесть строки), и ни одно из них не спрашивало,
 * начался ли эфир, — потому что спросить было негде: конвейер этого не
 * приносил. Замер 13.09.2026: восемь строк в разделе «идёт сейчас», НИ ОДНА
 * не шла. Подробности — в шапке файла.
 *
 * ОКНО В ЧАС остаётся поверх этого, а не вместо. Конвейер ходит раз в десять
 * минут, удаляет кончившееся сразу и чистит несвежее; час — это шесть
 * пропущенных прогонов подряд: столько конвейер не молчит, а если молчит, то
 * честнее пустой раздел, чем уверенное «идёт сейчас» под кончившимся матчем.
 *
 * ⚠️ СНАЧАЛА DROP: набор выходных колонок изменился (добавился `started_at`),
 * а `create or replace` этого не разрешает — 42P13.
 */
drop function if exists public.digest_live_matches(integer);
create or replace function public.digest_live_matches(p_limit integer default 8)
returns table (
  video_id   text,
  channel    text,
  title      text,
  seen_at    timestamptz,
  started_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.video_id, l.channel, l.title, l.seen_at, l.started_at
  from public.live_streams l
  where public.looks_like_match(l.title)
    and not public.is_studio_talk(l.title)
    and l.started_at is not null
    and l.seen_at > now() - interval '1 hour'
  -- По порядковым номерам: имена выходных колонок — заодно и OUT-параметры,
  -- и неквалифицированная ссылка на них здесь двусмысленна.
  order by 4 desc, 2
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

/**
 * Эфиры, которые ещё НЕ НАЧАЛИСЬ, но начнутся скоро.
 *
 * ⚠️ ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ПРОСТО ВЫБРОСИТЬ АНОНСЫ. Выбросить —
 * значит опустошить раздел: сегодня в таблице лежат ОДНИ анонсы, и починка
 * «показывать только идущее» на глаз неотличима от «перестало работать».
 * Анонс сам по себе полезен — врала ПОДПИСЬ под ним, а не он. Поэтому он
 * остаётся, но под своей: «начало в 20:00», со временем, а не «идёт сейчас».
 *
 * ОКНО ПО НАЗНАЧЕННОМУ ВРЕМЕНИ, А НЕ ПО `seen_at`. Страница канала показывает
 * ближайший назначенный эфир и тогда, когда он через двое суток, — и такую
 * строку конвейер видит свежей каждые десять минут. По `seen_at` она была бы
 * вечно «скоро»; по `scheduled_start_at` — только в свой день.
 *
 * ПЯТНАДЦАТЬ МИНУТ ЗАПАСА НАЗАД: конвейер ходит раз в десять минут, поэтому
 * `started_at` отстаёт от правды на прогон. Эфир, чьё время только что
 * наступило, — «вот-вот», а не «пропал с экрана».
 */
create or replace function public.digest_upcoming_matches(
  p_limit integer default 6,
  p_hours integer default 12
)
returns table (
  video_id           text,
  channel            text,
  title              text,
  scheduled_start_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.video_id, l.channel, l.title, l.scheduled_start_at
  from public.live_streams l
  where public.looks_like_match(l.title)
    and not public.is_studio_talk(l.title)
    and l.started_at is null
    and l.scheduled_start_at is not null
    and l.scheduled_start_at > now() - interval '15 minutes'
    and l.scheduled_start_at < now()
        + make_interval(hours => greatest(1, least(coalesce(p_hours, 12), 48)))
    and l.seen_at > now() - interval '1 hour'
  order by 4, 2
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

revoke all on function public.looks_like_match(text) from public;
revoke all on function public.is_studio_talk(text) from public;
revoke all on function public.digest_live_matches(integer) from public;
revoke all on function public.digest_upcoming_matches(integer, integer) from public;
grant execute on function public.looks_like_match(text) to anon, authenticated, service_role;
grant execute on function public.is_studio_talk(text) to anon, authenticated, service_role;
grant execute on function public.digest_live_matches(integer) to anon, authenticated, service_role;
grant execute on function public.digest_upcoming_matches(integer, integer) to anon, authenticated, service_role;

-- Эфир, которого конвейер не видит два часа, удаляется. Не час: чистка должна
-- пережить один пропущенный прогон, иначе она соревнуется с окном чтения выше.
create or replace function public.prune_live_streams()
returns void language sql security definer set search_path = public as $$
  delete from public.live_streams where seen_at < now() - interval '2 hours';
$$;
revoke all on function public.prune_live_streams() from public;
grant execute on function public.prune_live_streams() to service_role;

-- ---------------------------------------------------------------------------
-- Каналы, которые НЕ идут в дайджест голов, но идут в эфиры.
--
-- ЗАЧЕМ ОТДЕЛЬНЫЙ `kind`. football-digest фильтрует `kind = 'channel'`, а
-- live-streams читает `kind in ('channel','live')`. Значит строка с 'live'
-- видна только эфирам: лента голов не расширяется чужими турнирами, и квота
-- YouTube API не тратится — эфирам ключ вообще не нужен.
--
-- КАЖДЫЙ КАНАЛ ПРОВЕРЕН ОБХОДОМ ВКЛАДКИ `/streams`, а не взят по названию.
-- Проверка окупилась дважды:
--
--   @theafc                12 трансляций, 0 матчей — это ВООБЩЕ НЕ Азиатская
--                          конфедерация: «AFC GB Rehearsal vid», «Revolution
--                          Praise @ Momentum 2011». Тёзка по аббревиатуре.
--   @IndianSuperLeague     29 из 30 — «eISL», то есть КИБЕРФУТБОЛ. Настоящие
--                          клубы, настоящее «vs», играют в видеоигру.
--   @Ekstraklasa           29 трансляций, все «LIVE IRL», и в тех же
--                          заголовках написано «Mecz w Canal+Sport 3» — матч
--                          идёт на платном ТВ, а на YouTube его комментируют.
--
-- Ни один из трёх не заведён. Первые два случая заодно добавили исключений в
-- `is_studio_talk` — предикат их не ловил.
--
-- Заведены только те, у кого вкладка трансляций состоит из матчей:
--   Concacaf     30 из 30 — Copa Centroamericana
--   A-Leagues    30 из 30 — австралийская лига, включая финал
--   AFC Asian Cup 19 из 30 — женская Лига чемпионов АФК, полные матчи
-- ---------------------------------------------------------------------------
-- ⚠️ СНАЧАЛА РАСШИРИТЬ CHECK, и это поймала база, а не я. Колонка `kind`
-- ограничена списком ('feed','channel','espn_news'), в котором 'live' не было
-- — то есть ветка `kind in ('channel','live')` в live-streams была МЁРТВОЙ с
-- первого дня: строк с таким видом завести было нельзя. Функция при этом
-- работала, потому что каналы брались из 'channel'.
alter table public.digest_source drop constraint if exists digest_source_kind_check;
alter table public.digest_source add constraint digest_source_kind_check
  check (kind in ('feed', 'channel', 'espn_news', 'live'));

insert into public.digest_source (kind, name, ref, needs_key, enabled, note) values
  ('live', 'Concacaf',      'UCqn7r-so0mBLaJTtTms9dAQ', false, true,
   'Обход /streams 18.08.2026: 30 трансляций, 30 матчей. Copa Centroamericana.'),
  ('live', 'A-Leagues',     'UCzRogd_oK3bzKvAW-4aLuPQ', false, true,
   'Обход /streams 18.08.2026: 30 трансляций, 30 матчей, включая финал лиги.'),
  ('live', 'AFC Asian Cup', 'UCnj0TjaM0wyxkAWW_nz8_1g', false, true,
   'Обход /streams 18.08.2026: 30 трансляций, 19 матчей. Женская ЛЧ АФК, полные матчи.')
on conflict do nothing;
