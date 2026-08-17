-- ============================================================================
-- Кто показывает матчи в моей стране — от самого правообладателя.
--
-- ⚠️ ЭТО СОЗНАТЕЛЬНАЯ ОТМЕНА РЕШЕНИЯ, ЗАПИСАННОГО В broadcasts.sql. Там стоит:
--
--     «ЗДЕСЬ ТАКЖЕ НЕТ УТВЕРЖДЕНИЙ ВИДА "в России это показывает такой-то
--      канал". Права перепродаются каждый сезон, и таблица с ними устаревает
--      МОЛЧА — пользователь идёт по ссылке и попадает не туда, а приложение
--      при этом выглядит уверенным.»
--
-- Возражение было верным, и снято оно не желанием, а одним фактом: источник
-- САМ ОБЪЯВЛЯЕТ СРОК. Премьер-лига публикует список правообладателей с
-- периодом «2025/26–2027/28», и этот период лежит здесь в колонке. Устаревание
-- перестаёт быть молчаливым: строка знает, когда она перестаёт быть верной, и
-- экран может об этом сказать вместо того, чтобы уверенно врать.
--
-- ЧТО ЭТО НЕ ЕСТЬ. Не список стримов и не «где посмотреть бесплатно». Каждая
-- строка — официальный правообладатель, названный самой лигой на её
-- собственной странице. Соседняя таблица `broadcasts` остаётся: она ведёт на
-- страницу турнира и отвечает «где узнать», а эта отвечает «кто именно» —
-- и обе берут данные у того, кто ими владеет.
--
-- ⚠️ ТЕРРИТОРИЯ — НЕ ВСЕГДА СТРАНА, и поэтому она текстом, как её пишет
-- правообладатель. «Sub-Saharan Africa», «South Asia», «Pacific Islands»,
-- «Ships and planes» — это не страны и в ISO не переводятся. Код страны стоит
-- рядом ОТДЕЛЬНОЙ колонкой и только там, где территория однозначна: он для
-- поиска, а текст — для показа.
--
-- ⚠️ РОССИИ В СПИСКЕ АПЛ НЕТ, и это не пропуск при переносе. Премьер-лига не
-- называет правообладателя для России вовсе. Для приложения, у которого
-- русский — основной язык, это важнее половины остальных строк: экран обязан
-- сказать «в вашей стране официального вещателя не заявлено», а не молчать и
-- не подставлять соседа по алфавиту.
-- ============================================================================

create table if not exists public.broadcast_rights (
  -- Тот же ключ турнира, что в `fixtures` и `broadcasts`.
  sport_key   text not null,

  -- Название территории ДОСЛОВНО так, как её пишет правообладатель. Дословно —
  -- потому что это его формулировка прав, а не наша география.
  territory   text not null,

  -- Название вещателя, тоже дословно.
  broadcaster text not null,

  -- ISO 3166-1 alpha-2, и только для однозначных территорий. NULL у регионов
  -- («Sub-Saharan Africa») — не «неизвестно», а «территория не страна».
  country     text,

  -- ⚠️ ПРАВА НА ВЕСЬ МИР — ОТДЕЛЬНАЯ КАТЕГОРИЯ, а не «регион без кода».
  -- Их мало, но они есть: MLS продала все матчи Apple одним пакетом без
  -- деления по странам, и «MLS Season Pass» — единственный ответ читателю в
  -- любой точке. Через `country` это не выразить: NULL там значит «территория
  -- не страна», а не «подходит любой». Признак отдельной колонкой, потому что
  -- строкой-меткой вроде territory='Worldwide' пришлось бы сравнивать текст, и
  -- первая же опечатка выключила бы правило молча.
  --
  -- Конкретная строка важнее правила: если для страны есть СВОЙ вещатель, он
  -- и показывается — сортировка ниже ставит мировые права последними.
  worldwide   boolean not null default false,

  -- Срок, объявленный источником. Ради него всё и заведено.
  season_from text,
  season_to   text,

  -- Откуда взято. Не для отчётности: когда строка устареет, проверять надо
  -- ровно эту страницу, а не искать её заново.
  source_url  text not null,

  -- Когда сверяли с источником живым запросом.
  checked_at  timestamptz not null default now(),

  primary key (sport_key, territory, broadcaster)
);

comment on table public.broadcast_rights is
  'Официальные правообладатели по территориям, со сроком действия от самого источника. '
  'Не список стримов: каждая строка названа лигой на её собственной странице.';

create index if not exists broadcast_rights_country_idx
  on public.broadcast_rights (sport_key, country) where country is not null;

-- ─── Права доступа ──────────────────────────────────────────────────────────
--
-- Читать может любой: это публичная информация, опубликованная самой лигой.
-- Политика и грант стоят рядом — политика без гранта таблицу не открывает.
alter table public.broadcast_rights enable row level security;

drop policy if exists broadcast_rights_read on public.broadcast_rights;
create policy broadcast_rights_read on public.broadcast_rights for select using (true);

grant select on public.broadcast_rights to anon, authenticated;
grant select, insert, update, delete on public.broadcast_rights to service_role;

-- ─── Премьер-лига, сезоны 2025/26–2027/28 ───────────────────────────────────
--
-- Снято со страницы https://www.premierleague.com/en/media/broadcasters
-- 17.08.2026. Прежний адрес `/broadcast-schedules` отвечает 301 и ведёт сюда же;
-- в `broadcasts` он заменён на канонический — тем PR, который эту таблицу и
-- правит, а не этим.

insert into public.broadcast_rights
  (sport_key, territory, broadcaster, country, season_from, season_to, source_url) values
  -- Европа
  ('soccer_epl', 'Albania', 'Digitalb', 'AL', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Andorra', 'CANAL+/DAZN', 'AD', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Armenia', 'Saran Media', 'AM', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Austria', 'Sky Deutschland', 'AT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Belarus', 'Saran Media', 'BY', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Belgium', 'Telenet', 'BE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Bulgaria', 'IMG (sublicensed to Nova Broadcasting Group)', 'BG', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Croatia', 'Arena Sport', 'HR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Cyprus', 'Cytavision', 'CY', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Czech Republic', 'CANAL+', 'CZ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Denmark', 'Viaplay', 'DK', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Estonia', 'TV3', 'EE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Finland', 'Viaplay', 'FI', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'France', 'CANAL+', 'FR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Georgia', 'Saran Media', 'GE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Germany', 'Sky Deutschland', 'DE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Greece', 'IMG (sublicensed to Nova)', 'GR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Hungary', 'TV2', 'HU', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Iceland', 'Syn', 'IS', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Israel', 'Charlton', 'IL', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Republic of Ireland', 'Sky Sports, TNT Sports, Premier Sports', 'IE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Italy', 'Sky Italia', 'IT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Kosovo', 'Arena Sport', 'XK', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Latvia', 'TV3', 'LV', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Lithuania', 'TV3', 'LT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Luxembourg', 'CANAL+', 'LU', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Malta', 'TSN', 'MT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Moldova', 'Saran Media', 'MD', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Montenegro', 'Arena Sport', 'ME', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Netherlands', 'Viaplay', 'NL', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'North Macedonia', 'Arena Sport', 'MK', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Norway', 'Viaplay', 'NO', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Poland', 'CANAL+', 'PL', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Romania', 'Saran Media', 'RO', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Portugal', 'DAZN', 'PT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Serbia', 'Arena Sport', 'RS', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Slovakia', 'CANAL+', 'SK', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Slovenia', 'Arena Sport', 'SI', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Spain', 'DAZN', 'ES', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Sweden', 'Viaplay', 'SE', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Switzerland', 'CANAL+ (French), Sky Deutschland (German), Sky Italia (Italian)', 'CH', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Turkey', 'beIN Sports', 'TR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'United Kingdom', 'Sky Sports, TNT Sports, BBC Sport (highlights)', 'GB', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Ukraine', 'Setanta', 'UA', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),

  -- Азия и Тихий океан
  ('soccer_epl', 'Afghanistan', 'Saran Media', 'AF', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Australia', 'Stan Sport', 'AU', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Azerbaijan', 'Saran Media', 'AZ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Cambodia', 'Jasmine International/Mono', 'KH', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'China', 'Migu', 'CN', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Chinese Taipei', 'ELTA', 'TW', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Hong Kong', 'PCCW', 'HK', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Indonesia', 'EMTEK', 'ID', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Japan', 'U-Next', 'JP', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Kazakhstan', 'Saran Media', 'KZ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Kyrgyzstan', 'Saran Media', 'KG', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Laos', 'Jasmine International/Mono', 'LA', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Macao', 'M Plus', 'MO', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Malaysia', 'Astro', 'MY', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Mongolia', 'Unitel', 'MN', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Myanmar', 'CANAL+', 'MM', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'New Zealand', 'Sky NZ', 'NZ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Pacific Islands', 'Digicel', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Singapore', 'StarHub', 'SG', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'South Asia', 'JioStar', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'South Korea', 'Coupang', 'KR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Tajikistan', 'Saran Media', 'TJ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Thailand', 'Jasmine International/Mono', 'TH', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Turkmenistan', 'Saran Media', 'TM', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Uzbekistan', 'Saran Media', 'UZ', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Vietnam', 'FPT Play via Jasmine International/Mono', 'VN', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),

  -- Ближний Восток и Африка
  ('soccer_epl', 'Middle East and North Africa', 'beIN Sports', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Sub-Saharan Africa', 'SuperSport', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),

  -- Америка
  ('soccer_epl', 'Brazil', 'ESPN', 'BR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Canada', 'Fubo', 'CA', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Caribbean', 'ESPN', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Costa Rica', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'CR', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'El Salvador', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'SV', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Guatemala', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'GT', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Honduras', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'HN', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Mexico', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'MX', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Nicaragua', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'NI', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'Panama', 'Fox Broadcasting Corporation, TNT Sports Mexico', 'PA', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'South America', 'ESPN', null, '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters'),
  ('soccer_epl', 'United States', 'NBC Sports', 'US', '2025/26', '2027/28', 'https://www.premierleague.com/en/media/broadcasters')
on conflict (sport_key, territory, broadcaster) do update
  set country = excluded.country,
      season_from = excluded.season_from,
      season_to = excluded.season_to,
      source_url = excluded.source_url,
      checked_at = now();

-- ─── MLS: один вещатель на весь мир ─────────────────────────────────────────
--
-- РЕДКИЙ СЛУЧАЙ, И ПОТОМУ ОН ЗДЕСЬ. MLS продала все матчи Apple одним
-- пакетом, без деления по странам: «MLS Season Pass» — ответ читателю и в
-- Москве, и в Мехико. Проверено двумя независимыми источниками, а не одним:
-- страница лиги (`mlssoccer.com/how-to-watch`, объявляет сезон 2026) и
-- TV-выдача TheSportsDB, где у матчей MLS стоит strChannel «MLS Season Pass»
-- при strCountry «International» — то есть не по стране.
--
-- ОСТАЛЬНЫЕ ТУРНИРЫ СТРОК НЕ ПОЛУЧИЛИ, и это результат проверки, а не лень:
--   * laliga.com — страница «где смотреть» ПОДСТРАИВАЕТСЯ под страну
--     посетителя и таблицы не публикует. Раздел international-rights — про
--     тендеры, а не про действующих вещателей. Для неё ссылка честнее
--     таблицы, и ссылка уже есть в `broadcasts`.
--   * ligue1.com/en/broadcasters отвечает 200 и называет beIN Sports и
--     Ligue 1+, но без территорий и без срока — под условие не подходит.
--   * legaseriea.it/en/serie-a/broadcasters — 307 на главную,
--     bundesliga.com/en/bundesliga/tv-guide и laliga.com/en-GB/laliga-worldwide
--     — 404. «Очевидный» адрес снова оказался неверным.
insert into public.broadcast_rights
  (sport_key, territory, broadcaster, country, worldwide,
   season_from, season_to, source_url) values
  ('soccer_usa_mls', 'Worldwide', 'MLS Season Pass on Apple TV', null, true,
   '2026', '2026', 'https://www.mlssoccer.com/how-to-watch/')
on conflict (sport_key, territory, broadcaster) do update
  set country = excluded.country,
      worldwide = excluded.worldwide,
      season_from = excluded.season_from,
      season_to = excluded.season_to,
      source_url = excluded.source_url,
      checked_at = now();

-- ─── Чтение ─────────────────────────────────────────────────────────────────

/**
 * Правообладатели турнира, при желании — только для одной страны.
 *
 * ⚠️ ПУСТОЙ ОТВЕТ ЗНАЧИТ «НЕ ЗАЯВЛЕН», А НЕ «МЫ НЕ ЗНАЕМ», и экран обязан
 * говорить именно это. Для России у Премьер-лиги правообладателя нет вовсе —
 * а русский здесь основной язык, так что случай не редкий, а типовой. Молчание
 * на этом месте читатель прочтёт как поломку.
 */
create or replace function public.broadcast_rights_for(
  p_sport_key text default null,
  p_country   text default null
)
returns table (
  sport_key   text,
  territory   text,
  broadcaster text,
  country     text,
  season_from text,
  season_to   text,
  source_url  text,
  checked_at  timestamptz
)
language sql
stable
as $$
  select r.sport_key, r.territory, r.broadcaster, r.country,
         r.season_from, r.season_to, r.source_url, r.checked_at
  from public.broadcast_rights r
  where (p_sport_key is null or r.sport_key = p_sport_key)
    and (p_country   is null
         or r.country = upper(p_country)
         -- Мировые права подходят любой стране — но только когда страну
         -- вообще спросили. При p_country is null отдаётся всё как есть.
         or r.worldwide)
  -- СНАЧАЛА СВОЙ ВЕЩАТЕЛЬ, ПОТОМ МИРОВОЙ. Читатель, у которого есть местный
  -- правообладатель, должен увидеть его, а не глобальную подписку: она хоть и
  -- верна, но не то, чем он смотрит.
  order by r.sport_key, r.worldwide, r.territory;
$$;

-- ОБА АРГУМЕНТА НЕОБЯЗАТЕЛЬНЫ, и это ради одного пути чтения, а не ради
-- удобства. Экран расписания спрашивает «моя страна, все турниры» — шестьдесят
-- матчей на экране, но стран у читателя одна; карточка турнира спросила бы
-- «этот турнир, все страны». Две разные выборки означали бы два места, где
-- решается, что такое «правообладатель для страны», и однажды они разойдутся —
-- ровно та беда, от которой в проекте заведён один `cards_matching`.
grant execute on function public.broadcast_rights_for(text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Как добавить турнир.
--
--   1. Найти СОБСТВЕННУЮ страницу правообладателей у лиги (не агрегатор).
--   2. Проверить адрес запросом — см. шапку broadcasts.sql, там это правило
--      уже окупилось один раз.
--   3. INSERT со `season_from`/`season_to` ИЗ САМОГО ИСТОЧНИКА. Без срока
--      строку не заводить: именно срок отличает эту таблицу от той, которую
--      broadcasts.sql отказался вести.
-- ---------------------------------------------------------------------------
