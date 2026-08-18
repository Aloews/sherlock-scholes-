-- ============================================================================
-- Источники дайджеста — в таблице, а не в исходнике Edge Function.
--
-- ЗАЧЕМ. Состав источников — единственное, что в этой функции меняется часто:
-- лента умирает, канал оказывается тёзкой, появляется лига. А поменять его
-- можно было только одним способом — перенести в прод ВЕСЬ исходник функции
-- целиком. Перенос делает агент, перепечатывая шестьсот строк, и однажды уже
-- превратил `ё` в `ᑑ`. То есть цена добавления одной ленты — риск порчи всего
-- файла, и цена эта не имеет никакого отношения к размеру изменения.
--
-- Теперь добавление ленты — это INSERT, а снятие — `enabled = false`.
--
-- ПОЧЕМУ СНЯТЫЕ ОСТАЮТСЯ ЗДЕСЬ, А НЕ УДАЛЯЮТСЯ. Каждый снятый источник снят
-- по измеренной причине, и причина эта не выводится из его имени: `@EFL`
-- выглядит как Английская футбольная лига, `soccer.ru` отвечает 200. Удалить
-- строку — значит выбросить результат замера, и следующий добросовестно
-- добавит источник обратно, потратив на тот же замер тот же день. Строка с
-- `enabled = false` и заполненным `note` стоит ничего и отвечает на вопрос
-- «почему её тут нет» до того, как он задан.
--
-- ЧИТАЕТ ЭТО ТОЛЬКО КОНВЕЙЕР. Клиенту список источников не нужен: он видит
-- готовые строки в `news_items` и `goal_clips`. Поэтому RLS включён, политик
-- нет и грантов сверх service_role тоже нет.
-- ============================================================================

create table if not exists public.digest_source (
  id bigserial primary key,

  -- Чем этот источник является для функции — от этого зависит и как его
  -- читать, и куда класть результат.
  --   feed       — RSS/Atom издания           → news_items
  --   channel    — канал YouTube              → goal_clips
  --   espn_news  — лига в новостном API ESPN  → news_items
  kind text not null check (kind in ('feed', 'channel', 'espn_news')),

  -- Как источник называется в отчёте и в строке таблицы. Для feed это то, что
  -- увидит читатель в `news_items.source`, поэтому менять его задним числом
  -- нельзя: уже записанные строки останутся со старым именем.
  name text not null,

  -- Адрес: url ленты, идентификатор канала (`UC…`), слаг лиги ESPN.
  --
  -- ⚠️ Для канала — ИДЕНТИФИКАТОР, а не @-имя. Имя это адрес, владелец может
  -- его сменить, и тогда лента молча опустеет.
  ref text not null,

  -- Язык ленты. Только для feed; у роликов языка нет, у ESPN он всегда en.
  --
  -- ⚠️ ДВА ИСТОЧНИКА НА ЯЗЫК — МИНИМУМ, НИЖЕ КОТОРОГО ГРОМКОСТЬ НЕ РАБОТАЕТ.
  -- Она считается как «сколько разных изданий вышло с тем же сюжетом», так что
  -- при одном источнике тождественно равна единице, и лента вырождается в
  -- хронологию. Снимая последнюю ленту языка, снимай и язык.
  lang text,

  -- Нужен ли для этого источника YOUTUBE_API_KEY.
  --
  -- ⚠️ Это НЕ про удобство. Atom-фид YouTube закрыт его же robots.txt
  -- (`Disallow: /feeds/videos.xml`). Пять исторических каналов ходят по нему и
  -- остаются как есть, но РАСШИРЯТЬ закрытый путь нельзя — всё, что добавлено
  -- после, включается только вместе с ключом, то есть по официальному API.
  needs_key boolean not null default false,

  enabled boolean not null default true,

  -- Почему источник здесь — и, если он выключен, что именно было измерено.
  note text,

  created_at timestamptz not null default now(),

  unique (kind, ref)
);

comment on table public.digest_source is
  'Источники football-digest. Добавление ленты — INSERT, снятие — enabled=false с причиной в note.';

-- Функция берёт только включённые, разложенные по виду.
create index if not exists digest_source_enabled_idx
  on public.digest_source (kind, id) where enabled;

-- ---------------------------------------------------------------------------
-- Ленты изданий.
--
-- Языков без проверенной ленты (ar, ja, ko, zh) здесь нет намеренно: пустой
-- язык выглядел бы как поддержка, которой не существует. `digest_news()`
-- отдаёт таким читателям английский.
-- ---------------------------------------------------------------------------
insert into public.digest_source (kind, name, ref, lang, enabled, note) values
  ('feed', 'BBC Sport', 'https://feeds.bbci.co.uk/sport/football/rss.xml', 'en', true, null),
  ('feed', 'The Guardian', 'https://www.theguardian.com/football/rss', 'en', true, null),
  ('feed', 'Чемпионат', 'https://www.championat.com/rss/news/football/', 'ru', true, null),
  ('feed', 'Спорт-Экспресс', 'https://www.sport-express.ru/services/materials/news/se/', 'ru', true,
   'Замена умершему soccer.ru. 499 записей, дата с настоящей зоной и читается.'),
  ('feed', 'Marca', 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml', 'es', true, null),
  ('feed', 'Mundo Deportivo', 'https://www.mundodeportivo.com/feed/rss/futbol', 'es', true, null),
  ('feed', 'Record', 'https://www.record.pt/rss', 'pt', true,
   'Объявляет ISO-8859-1 и экранирует собственные скобки CDATA — оба случая разобраны в index.ts.'),
  ('feed', 'Foot Mercato', 'https://www.footmercato.net/flux-rss', 'fr', true, null),

  -- Снятые. Каждая причина — результат запроса, и по имени источника она не видна.
  ('feed', 'РИА Спорт', 'https://rsport.ria.ru/export/rss2/archive/index.xml', 'ru', false,
   'Адрес отвечает 301, а цель редиректа 404. Лента переехала.'),
  ('feed', 'Soccer.ru', 'https://www.soccer.ru/rss', 'ru', false,
   'Отвечает 302 на страницу «Проверка безопасности» и отдаёт ноль item-ов. Выглядит живым: HTTP 200 на итоговой странице.'),

  -- ВЕРНУЛСЯ. Он был снят не за то, что плох, а за то, что его дату не умели
  -- читать: «Sun, 16 Aug 2026 19:27:00 BST» — new Date() такую зону не знает и
  -- возвращает Invalid Date, поэтому источник отдавал двадцать свежих заметок
  -- и ноль строк. Теперь буквенные зоны разбираются (NAMED_ZONES в index.ts),
  -- и BST проверен на живой дате.
  -- ⚠️ 11095, а не 12040. Лента 12040 — ОБЩЕСПОРТИВНАЯ, и по имени этого не
  -- видно: замер за двое суток дал 11 не-футбольных материалов из 26 (гольф,
  -- NFL, скачки, F1, крикет), а крикетный финал даже стал одной из десяти
  -- горячих тем дайджеста. Проверено обеими лентами подряд: 11095 отдаёт 19
  -- футбольных материалов из 20, 12040 — 6 из 20.
  ('feed', 'Sky Sports', 'https://www.skysports.com/rss/11095', 'en', true,
   'Футбольная лента Sky. Единственная лента с буквенной зоной (BST) — держится на NAMED_ZONES в index.ts; если оттуда убрать BST, источник снова станет молча пустым.')
on conflict (kind, ref) do nothing;

-- Прежняя общеспортивная лента остаётся строкой с причиной, а не удаляется:
-- без неё следующий добросовестно вернёт 12040 обратно — имя у неё такое же,
-- и по нему разницы не видно.
update public.digest_source
   set enabled = false,
       note = 'Общеспортивная лента: 11 из 26 материалов за двое суток — гольф, NFL, скачки, F1, крикет. Заменена на rss/11095, футбольную.'
 where kind = 'feed' and ref = 'https://www.skysports.com/rss/12040';

-- ---------------------------------------------------------------------------
-- Каналы лиг на YouTube.
--
-- Идентификаторы взяты со страниц самих каналов методом, который сам сначала
-- проверен: разбор `rel="canonical"` прогнан по двум каналам с заранее
-- известными id (Premier League, LALIGA) и сошёлся на обоих. Без такой сверки
-- первый подход дал «Бразилейрао» идентификатор LALIGA — он попадался в блоке
-- рекомендаций.
-- ---------------------------------------------------------------------------
insert into public.digest_source (kind, name, ref, needs_key, enabled, note) values
  ('channel', 'Premier League', 'UCG5qGWdu8nIRZqJ_GgDwQ-w', false, true, null),
  ('channel', 'LALIGA', 'UCTv-XvfzLX3i4IGWAm4sbmA', false, true, null),
  ('channel', 'Serie A', 'UCBJeMCIeLQos7wacox4hmLQ', false, true, null),
  ('channel', 'Ligue 1', 'UCQsH5XtIc9hONE1BQjucM0g', false, true, null),
  ('channel', 'UEFA', 'UCyGa1YEx9ST66rYrJTGIKOw', false, true, null),

  -- Всё, что играет, когда Европа отдыхает. Добавлено после ключа, поэтому
  -- needs_key: расширять закрытый в robots.txt Atom-путь нельзя.
  ('channel', 'Bundesliga', 'UC6UL29enLNe4mqwTfAyeNuw', true, true, null),
  ('channel', 'MLS', 'UCSZbXT5TLLW_i-5W8FZpFsg', true, true, null),
  ('channel', 'CONMEBOL', 'UCzU8-lZlRfkV3nj0RzAZdrQ', true, true, null),
  ('channel', 'Liga MX', 'UCq8BPLXtFeiSFOvmJrknWGg', true, true, null),

  -- Снятые после первого же прогона. Оба искались по @-имени, и оба показали,
  -- что имя — не проверка.
  ('channel', 'EFL', 'UCkgm4b5n3QsMUgB9FjA8S2w', true, false,
   'Вернул НОЛЬ. @EFL разрешается в канал с заголовком «efl» строчными — тёзка, а не Английская футбольная лига.'),
  ('channel', 'Brasileirão', 'UCrf4Fr6uTCoU9RkYa5CbzcA', true, false,
   'Ролики отдаёт, но все старше десяти дней — prune_digest чистит их сразу. Платит две единицы квоты за прогон и не приносит ничего.')
on conflict (kind, ref) do nothing;

-- ---------------------------------------------------------------------------
-- Лиги новостного API ESPN.
--
-- Ключа не требует, свежесть замерена: статья, вышедшая за семь минут до
-- запроса. Клиент к этому же API уже написан для статистики
-- (football_scraper/scraper/espn.py), новой зависимости не появляется.
--
-- ⚠️ В ответе ESPN лежат КОЭФФИЦИЕНТЫ (`odds`, `pickcenter`) — на уровне
-- матча, не новости. Разбор читает только `articles`; коэффициенты в этом
-- проекте внутренние, и ничего производного от них на экран попасть не может.
-- ---------------------------------------------------------------------------
insert into public.digest_source (kind, name, ref, lang, enabled) values
  ('espn_news', 'ESPN', 'eng.1', 'en', true),
  ('espn_news', 'ESPN', 'esp.1', 'en', true),
  ('espn_news', 'ESPN', 'ita.1', 'en', true),
  ('espn_news', 'ESPN', 'ger.1', 'en', true),
  ('espn_news', 'ESPN', 'fra.1', 'en', true),
  ('espn_news', 'ESPN', 'uefa.champions', 'en', true)
on conflict (kind, ref) do nothing;

-- ---------------------------------------------------------------------------
-- Права.
--
-- ⚠️ ПОЛИТИКА — ЭТО НЕ ГРАНТ. Postgres проверяет грант ПЕРВЫМ и отвечает 42501
-- до того, как посмотрит на политику. Здесь не нужно ни того, ни другого:
-- список источников читает только конвейер под service_role.
-- ---------------------------------------------------------------------------
alter table public.digest_source enable row level security;

revoke all on public.digest_source from anon, authenticated;
revoke all on sequence public.digest_source_id_seq from anon, authenticated;
grant select, insert, update, delete on public.digest_source to service_role;

-- ---------------------------------------------------------------------------
-- Как этим пользоваться.
--
--   -- добавить ленту
--   insert into digest_source (kind, name, ref, lang)
--   values ('feed', 'Kicker', 'https://newsfeed.kicker.de/news/aktuell', 'de');
--
--   -- снять источник, оставив причину
--   update digest_source set enabled = false,
--          note = 'Отдаёт 403 с середины сентября'
--    where kind = 'feed' and name = 'Marca';
--
--   -- что сейчас работает
--   select kind, name, lang, needs_key from digest_source where enabled order by kind, id;
--
-- Деплой функции при этом не нужен: она читает таблицу на каждом прогоне.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Каналы для раздела «идёт сейчас» — kind='live'.
--
-- ОТДЕЛЬНЫЙ ВИД, А НЕ 'channel', И ЭТО РАЗДЕЛЕНИЕ ПОТРЕБИТЕЛЕЙ. football-digest
-- читает `kind = 'channel'` и качает оттуда голы официальным API (2 единицы
-- квоты на канал за прогон); live-streams читает `kind in ('channel','live')`
-- и ходит на публичную страницу без ключа. Канал, который ведёт живые матчи, но
-- голов в ленту не даёт, попадает сюда и не расширяет ни ленту, ни расход
-- квоты.
--
-- КАЖДЫЙ ВЫБРАН ЗАМЕРОМ, а не по названию: обход вкладки `/streams` и разбор
-- заголовков тем же правилом, что в live_streams.sql (18.08.2026).
--
--   Concacaf       30 из 30 — матчи (Copa Centroamericana)
--   A-Leagues      30 из 30 — матчи, включая Grand Final
--   AFC Asian Cup  19 из 30 — матчи (женская Лига чемпионов АФК, Full Match)
--
-- ⚠️ ЧЕТЫРЕ КАНДИДАТА ОТВЕРГНУТЫ, И ПРИЧИНЫ СТОИТ ЗНАТЬ:
--
--   Indian Super League  29 из 30 «матчей» — это eISL, КИБЕРФУТБОЛ. Настоящие
--                        клубы, настоящее «vs», играют в видеоигру.
--   Ekstraklasa          все трансляции — «LIVE IRL», сопроводительный стрим;
--                        в тех же заголовках стоит «Mecz w Canal+Sport 3», то
--                        есть сам матч идёт на платном ТВ.
--   J.League             48 трансляций, все — 【公式】ハイライト, то есть обзоры.
--   @theafc              ЧУЖОЙ КАНАЛ. Имя совпадает, содержимое не про футбол
--                        («AFC GB Rehearsal vid»). Настоящий — @AFCAsianCup.
--
-- Первые два не отсекались предикатом и стоили ему двух новых правил; см.
-- is_studio_talk в live_streams.sql.
-- ---------------------------------------------------------------------------
insert into public.digest_source (kind, name, ref, needs_key, enabled, note) values
  ('live', 'Concacaf',      'UCqn7r-so0mBLaJTtTms9dAQ', false, true,
   'Обход 18.08.2026: 30 из 30 — матчи. Второй канал Concacaf (UCmRvpIjXIvBhQ0jWo2EthuA) трансляций не ведёт вовсе.'),
  ('live', 'A-Leagues',     'UCzRogd_oK3bzKvAW-4aLuPQ', false, true,
   'Обход 18.08.2026: 30 из 30 — матчи, включая Grand Final.'),
  ('live', 'AFC Asian Cup', 'UCnj0TjaM0wyxkAWW_nz8_1g', false, true,
   'Обход 18.08.2026: 19 из 30 — матчи. Канал @theafc — чужой, футбола там нет.')
on conflict do nothing;
