-- ============================================================================
-- ПРОИСХОЖДЕНИЕ СОБРАННОГО КОНТЕНТА: у каждой записи известно, ЧЬЁ это.
--
-- ⚠️ ПРОСЬБА БЫЛА «НЕЗАМЕТНАЯ МАРКИРОВКА, ЧТОБЫ НЕ БЫЛО ПРОБЛЕМ С ПРАВАМИ»,
-- И БУКВАЛЬНО ЕЁ ВЫПОЛНИТЬ НЕЛЬЗЯ. Невидимая метка на чужом файле не даёт
-- права этот файл показывать: право даёт лицензия, а не метка. Хуже: у
-- половины нашего материала лицензия ТРЕБУЕТ ВИДИМОЙ подписи (CC BY-SA), и
-- скрытая пометка своим ключом там не «решает вопрос», а приближает его к
-- присвоению — файл на экране без автора, автор спрятан в базе.
--
-- Поэтому здесь сделано то, что вопрос действительно закрывает, и оно
-- состоит из двух частей:
--
--   1. НЕВИДИМОЕ — происхождение у каждой записи: источник, лицензия, дата,
--      ссылка. На экране ничего не меняет, но на любой вопрос «откуда это
--      у вас» отвечает строкой из базы, а не памятью.
--   2. ВИДИМОЕ — подпись там, где её требует лицензия. Без неё пункт 1 не
--      имеет смысла: он лишь аккуратно документирует нарушение.
--
-- ЧТО ПОКАЗАЛ ЗАМЕР (22.09.2026, боевая база). Ни одной колонки о правах в
-- проекте не было вовсе; «источник» встречался в одиннадцати колонках и
-- означал ШАГ КОНВЕЙЕРА, а не владельца: `wiki_career`, `club_roster`,
-- `sitelink`, `roster`, `same_match`. По такой строке нельзя ответить,
-- чей это материал и на каких условиях он у нас.
--
--   фото карточек   7278 с Викисклада (CC BY-SA/PD — подпись ОБЯЗАТЕЛЬНА,
--                        её не было ни одной), 5335 Transfermarkt,
--                        707 ESPN, 429 SoccerWiki, 162 TheSportsDB
--   описания        3526 карточек, собраны из Википедии (CC BY-SA 4.0,
--                        подпись обязательна, её не было)
--   карьеры         24 550 строк club_squad из статей Википедии
--   статистика      113 960 строк sports.ru + 52 737 ESPN
--   переводы имён   21 270 из Викиданных (CC0 — подпись не требуется)
--
-- ⚠️ КОЛОНКА `license_ok` — ЭТО ПОЗИЦИЯ ЧЕЛОВЕКА, А НЕ ВЫВОД СКРИПТА.
-- Сборщик её не трогает и трогать не должен. `false` означает ровно одно:
-- «мы показываем это, не имея на руках разрешения» — и это не приговор, а
-- строка, которую владелец видит и решает, что с ней делать (договориться,
-- заменить источник, убрать). Раньше такой строки не существовало, и решать
-- было не по чему.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Реестр источников: кто владеет и на каких условиях.
--
-- Это справочник, а не журнал: строк тут десяток, и каждую заводит человек.
-- ---------------------------------------------------------------------------
create table if not exists public.content_source (
  -- Ключ, которым ссылаются колонки происхождения.
  key                  text primary key,

  -- Как называть источник НА ЭКРАНЕ. Не переводится: «Wikimedia Commons»
  -- подписью и должен остаться — подпись обязана совпадать с тем, что
  -- требует лицензия, а не с языком интерфейса.
  title                text not null,
  homepage             text,

  -- Лицензия так, как её называет сам источник. 'proprietary' — это НЕ
  -- лицензия, а честная запись «лицензии у нас нет».
  license              text not null,
  license_url          text,

  -- Как именно лицензия требует подписывать. Три значения, и они разные:
  --
  --   'none'       подпись не требуется (CC0, наше собственное);
  --   'source'     довольно назвать источник в одном месте приложения —
  --                так работают текст и данные Википедии;
  --   'per_record' у КАЖДОГО файла свой автор и своя лицензия, и подпись
  --                нужна рядом с файлом. Викисклад именно такой: два
  --                снимка одного игрока бывают под разными лицензиями.
  attribution          text not null
                       check (attribution in ('none', 'source', 'per_record')),

  -- Есть ли у нас право это показывать. Ставит человек — см. шапку.
  license_ok           boolean not null,

  -- Условия источника, чтобы не искать их заново.
  terms_url            text,

  -- Чем это у нас является и что известно про условия. По-русски: читать
  -- будет владелец, а не парсер.
  note                 text
);

comment on table public.content_source is
  'Реестр источников контента: лицензия, форма подписи, есть ли право показывать.';

-- ---------------------------------------------------------------------------
-- 2. Мост: что РЕАЛЬНО лежит в наших колонках → чей это материал.
--
-- ⚠️ БЕЗ ЭТОЙ ТАБЛИЦЫ РЕЕСТР БЕСПОЛЕЗЕН. В базе не написано «Википедия» —
-- написано `wiki_career`, `career_stats`, `squad`. И не «Викисклад» —
-- а `commons.wikimedia.org` внутри ссылки. Мост переводит одно в другое,
-- и только он позволяет посчитать, сколько у нас чужого.
--
-- `kind = 'label'` — значение колонки `*_source`;
-- `kind = 'host'`  — хост из ссылки на файл.
-- ---------------------------------------------------------------------------
create table if not exists public.content_origin (
  -- 'label'  — значение колонки-источника;
  -- 'host'   — хост из ссылки на файл;
  -- 'column' — вся колонка целиком, когда её значения НЕ словарь (названия
  --            изданий в новостях открыты: новая лента даёт новое имя).
  kind        text not null check (kind in ('label', 'host', 'column')),
  token       text not null,
  source_key  text not null references public.content_source(key) on update cascade,
  primary key (kind, token)
);

comment on table public.content_origin is
  'Значение колонки-источника или хост ссылки → ключ в content_source.';

-- ---------------------------------------------------------------------------
-- 3. Наполнение реестра.
--
-- Заполняется через upsert: миграция применяется повторно, а `note` и
-- `license_ok` человек правит руками — затирать его правку нельзя нигде,
-- кроме полей, которые описывают сам источник.
-- ---------------------------------------------------------------------------
insert into public.content_source
  (key, title, homepage, license, license_url, attribution, license_ok, terms_url, note)
values
  ('wikipedia', 'Википедия', 'https://ru.wikipedia.org',
   'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/',
   'source', true, 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
   'Описания карточек и таблицы карьеры. Лицензия разрешает использование, '
   'включая коммерческое, при указании источника. Достаточно назвать '
   'Википедию в одном месте приложения — это и есть экран «Источники».'),

  ('wikimedia_commons', 'Wikimedia Commons', 'https://commons.wikimedia.org',
   'по файлу', 'https://commons.wikimedia.org/wiki/Commons:Licensing',
   'per_record', true, 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia',
   'Фотографии. ⚠️ ЛИЦЕНЗИЯ У КАЖДОГО ФАЙЛА СВОЯ: CC BY-SA разных версий, '
   'CC BY, общественное достояние. Поэтому автор и лицензия хранятся у '
   'КАЖДОГО снимка, а не берутся из этой строки.'),

  ('wikidata', 'Викиданные', 'https://www.wikidata.org',
   'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/',
   'none', true, 'https://www.wikidata.org/wiki/Wikidata:Licensing',
   'Имена на девяти языках, идентификаторы, даты рождения. CC0 — подпись '
   'не требуется вовсе. Названы всё равно: скрывать происхождение незачем.'),

  ('sports_ru', 'Sports.ru', 'https://www.sports.ru',
   'proprietary', null,
   'source', false, 'https://www.sports.ru/help/agreement/',
   'Голы, передачи, минуты по матчам. Сами по себе это ФАКТЫ, и факт '
   'авторским правом не охраняется — но выгрузка сделана обходом страниц, '
   'разрешения на это у нас нет. Строка стоит здесь именно для того, чтобы '
   'об этом было видно.'),

  ('espn', 'ESPN', 'https://www.espn.com',
   'proprietary', null,
   'source', false, 'https://disneytermsofuse.com/',
   'Статистика матчей и эмблемы клубов из открытого API сайта. Публичный '
   'ответ сервера — не лицензия.'),

  ('transfermarkt', 'Transfermarkt', 'https://www.transfermarkt.com',
   'proprietary', null,
   'source', false, 'https://www.transfermarkt.com/intern/anb',
   'Составы, стоимости, трансферы и фотографии. Фотографии отдаются '
   'ссылкой на их сервер — то есть показываются с их трафиком и без их '
   'разрешения. Самая уязвимая часть из всего списка.'),

  ('soccerwiki', 'SoccerWiki', 'https://soccerwiki.org',
   'proprietary', null,
   'source', false, 'https://soccerwiki.org/',
   'Рейтинги, текущие клубы, фотографии игроков и тренеров.'),

  ('thesportsdb', 'TheSportsDB', 'https://www.thesportsdb.com',
   'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/',
   'source', true, 'https://www.thesportsdb.com/faq',
   'Эмблемы клубов. Проект объявляет данные под CC BY-SA при указании '
   'источника; у отдельных логотипов остаются права самих клубов — '
   'но это товарный знак, а не наш случай использования.'),

  ('rss_publishers', 'Новостные издания', null,
   'заголовок + ссылка', null,
   'source', true, null,
   'Новости: только заголовок, короткая выжимка и ССЫЛКА НА ИЗДАНИЕ. '
   'Ссылка и есть подпись, и она стоит у каждой новости. Полные тексты '
   'не хранятся и не показываются — это то, что делает раздел законным.'),

  ('wikipedia_local', 'Википедия (локальная загрузка)', 'https://ru.wikipedia.org',
   'по файлу', null,
   'source', false, 'https://ru.wikipedia.org/wiki/Википедия:Критерии_добросовестного_использования',
   'Файл, загруженный НЕ на Викисклад, а в языковой раздел. Там лежит в том '
   'числе несвободное — по критериям добросовестного использования, которые '
   'на нас не распространяются. Лицензию такого файла надо смотреть вручную; '
   'пока она не установлена, показывать его мы права не имеем.'),

  ('own', 'Sherlock Scholes', null,
   'own', null,
   'none', true, null,
   'Наше собственное: связки, псевдонимы клубов, выводы моделей, рейтинги, '
   'ручные карточки. Ничьих прав не затрагивает.')
on conflict (key) do update set
  title       = excluded.title,
  homepage    = excluded.homepage,
  license     = excluded.license,
  license_url = excluded.license_url,
  attribution = excluded.attribution,
  terms_url   = excluded.terms_url;
  -- ⚠️ `license_ok` и `note` НЕ ОБНОВЛЯЮТСЯ: это поля человека.

-- ---------------------------------------------------------------------------
-- 4. Наполнение моста — по ЗАМЕРУ боевой базы, а не по догадке.
--
-- Каждая строка ниже встречается в данных прямо сейчас. Значение, которого
-- в мосте нет, ревизия покажет как «источник не опознан», и это правильное
-- поведение: новый сборщик обязан завести себе строку здесь.
-- ---------------------------------------------------------------------------
insert into public.content_origin (kind, token, source_key) values
  -- card_current_club.source
  ('label', 'soccerwiki',      'soccerwiki'),
  ('label', 'club_roster',     'transfermarkt'),
  ('label', 'career_stats',    'wikipedia'),
  ('label', 'legend_career',   'own'),
  ('label', 'derived:matches', 'own'),
  -- card_position.source
  ('label', 'roster',          'transfermarkt'),
  ('label', 'squad',           'wikipedia'),
  -- card_translations.source
  ('label', 'sitelink',        'wikidata'),
  ('label', 'label',           'wikidata'),
  ('label', 'name_en',         'own'),
  -- club_alias.source — всё выведено нами из своих же данных
  ('label', 'card',            'own'),
  ('label', 'same_match',      'own'),
  ('label', 'player_overlap',  'own'),
  ('label', 'seed',            'own'),
  ('label', 'card_bare',       'own'),
  -- club_crest.source
  ('label', 'espn',            'espn'),
  ('label', 'thesportsdb',     'thesportsdb'),
  -- club_squad.source
  ('label', 'wiki_career',     'wikipedia'),
  ('label', 'wikidata',        'wikidata'),
  ('label', 'matches',         'own'),
  -- league_season.source
  ('label', 'detected',        'own'),
  -- player_match_stats.source, player_match_days.source
  ('label', 'sports.ru',       'sports_ru'),
  -- players_meta.name_source
  ('label', 'none',            'own'),
  -- cards.descriptions_source / cards.photo_source — уже ключи реестра,
  -- но мост обязан их понимать: иначе ревизия назовёт своё же поле чужим.
  ('label', 'wikipedia',         'wikipedia'),
  ('label', 'wikimedia_commons', 'wikimedia_commons'),
  ('label', 'transfermarkt',     'transfermarkt'),
  ('label', 'sports_ru',         'sports_ru'),
  ('label', 'own',               'own'),
  ('label', 'rss_publishers',    'rss_publishers'),

  -- Хосты файлов.
  ('host', 'commons.wikimedia.org',          'wikimedia_commons'),
  ('host', 'upload.wikimedia.org',           'wikimedia_commons'),
  ('host', 'thumb.wikimedia.org',            'wikimedia_commons'),
  ('host', 'img.a.transfermarkt.technology', 'transfermarkt'),
  ('host', 'a.espncdn.com',                  'espn'),
  ('host', 'cdn.soccerwiki.org',             'soccerwiki'),
  ('host', 'r2.thesportsdb.com',             'thesportsdb'),
  ('host', 'www.thesportsdb.com',            'thesportsdb')
on conflict (kind, token) do update set source_key = excluded.source_key;

-- Колонка целиком принадлежит одному источнику, и её значения — НЕ словарь.
-- `news_items.source` хранит название издания («Mundo Deportivo», «Чемпионат»),
-- и список этих названий открыт: новая лента добавляет новое имя. Перечислять
-- их в мосте бессмысленно — колонка описывается один раз целиком.
insert into public.content_origin (kind, token, source_key) values
  ('column', 'news_items.source',    'rss_publishers'),
  ('column', 'news_items.image_url', 'rss_publishers')
on conflict (kind, token) do update set source_key = excluded.source_key;

-- ---------------------------------------------------------------------------
-- 5. Разрешение: ссылка → источник, метка → источник.
--
-- ⚠️ НЕИЗВЕСТНОЕ ВОЗВРАЩАЕТ NULL, А НЕ «прочее». Пустой ключ — это сигнал
-- ревизии «появился сборщик, который себя не назвал». Значение-заглушка
-- сделало бы ровно то, против чего вся эта миграция: спрятало бы чужое
-- под своим.
-- ---------------------------------------------------------------------------
-- ⚠️ upload.wikimedia.org РАЗДАЁТ ДВА РАЗНЫХ МИРА ПО ОДНОМУ ХОСТУ, И ЭТО
-- НАШЛОСЬ ЗАМЕРОМ, А НЕ ЧТЕНИЕМ. Из 35 ссылок на этот хост 34 ведут в
-- /wikipedia/commons/ — Викисклад, свободные лицензии. Одна ведёт в
-- /wikipedia/ru/, то есть в ЛОКАЛЬНУЮ загрузку языкового раздела, куда
-- кладут в том числе несвободное по «критериям добросовестного
-- использования» — а эти критерии писаны для энциклопедии, не для нас.
-- Разрешение по одному хосту назвало бы такой файл Викискладом и приписало
-- бы ему лицензию, которой у него нет.
--
-- ⚠️ ЭТА ФУНКЦИЯ — БЕЗ `security definer` И БЕЗ `set`, И ЭТО ИЗ ЗАМЕРА.
-- Ревизия зовёт её на каждую строку с картинкой, а `set search_path` мешает
-- Postgres встроить тело и добавляет свою цену на каждый вызов. Замеры
-- полного прохода ревизии: через обёртку с `set` в обеих ветках — 13.3 с,
-- только в ветке ссылок — 6.8 с, через эту чистую функцию — 5.5 с. Наружу
-- ходит обёртка ниже: анониму нужен `security definer`, ревизии — скорость.
create or replace function public.content_source_key(p_url text)
returns text
language sql stable parallel safe as $$
  select case
    when p_url ~ '^https?://upload\.wikimedia\.org/wikipedia/'
     and p_url !~ '^https?://upload\.wikimedia\.org/wikipedia/commons/'
      then 'wikipedia_local'
    else (select o.source_key
            from public.content_origin o
           where o.kind = 'host'
             and o.token = substring(p_url from '^https?://([^/]+)')
           limit 1)
  end;
$$;

create or replace function public.content_source_of_url(p_url text)
returns text
language sql stable security definer set search_path = public as $$
  select public.content_source_key(p_url);
$$;

create or replace function public.content_source_of_label(p_label text)
returns text
language sql stable security definer set search_path = public as $$
  select o.source_key
    from public.content_origin o
   where o.kind = 'label' and o.token = p_label
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. Подпись к ФАЙЛУ — по ссылке, а не по карточке.
--
-- ⚠️ ПЕРВАЯ ВЕРСИЯ ДЕРЖАЛА АВТОРА В КОЛОНКАХ `cards`, И ЭТО БЫЛО НЕВЕРНО.
-- Один и тот же снимок лежит в трёх местах: `cards.photo_url`,
-- `players_meta.photo_url` и кэш `player_spotlight_cache.photo_url` — замер
-- дал 7278, 1844 и 1750 ссылок на одни и те же 7072 файла. Подпись в колонке
-- карточки означала бы, что один файл подписан, а две его копии на экране —
-- нет, и ревизия честно считала бы их «без подписи» до бесконечности: писать
-- автора в кэш некуда и незачем.
--
-- Автор принадлежит ФАЙЛУ. Поэтому ключ здесь — ссылка, и любая таблица,
-- которая эту ссылку показывает, получает подпись одним join'ом.
--
-- ⚠️ «СТРОКИ НЕТ» И «АВТОРА НЕТ» — РАЗНОЕ, И ПУТАТЬ ИХ НЕЛЬЗЯ. Часть файлов
-- Викисклада в общественном достоянии, и автора у них не указано вовсе —
-- это законный ответ источника, а не пробел. Поэтому наличие СТРОКИ значит
-- «у источника спросили», а `author is null` внутри строки — «автор не
-- назван». Ровно та же ловушка, что с `minutes` в player_match_stats, где
-- ноль вместо NULL поднял бы игрока в рейтинге.
-- ---------------------------------------------------------------------------
create table if not exists public.media_credit (
  -- Ссылка ровно в том виде, в каком она лежит в карточке: подпись ищется
  -- по ней, и нормализация здесь развела бы ключ с данными.
  url          text primary key,
  source_key   text references public.content_source(key) on update cascade,
  author       text,
  license      text,
  license_url  text,
  -- Страница файла у источника — куда ведёт подпись на экране.
  credit_url   text,
  asked_at     timestamptz not null default now()
);

comment on table public.media_credit is
  'Подпись к ФАЙЛУ по его ссылке: автор, лицензия, страница файла. Строка есть = у источника спросили.';
comment on column public.media_credit.author is
  'NULL при наличии строки = у файла автора НЕТ (общественное достояние). Отсутствие строки = не спрашивали.';

-- Происхождение у карточки: только источник. Автор и лицензия — в media_credit.
alter table public.cards
  add column if not exists photo_source        text,
  add column if not exists descriptions_source text;

comment on column public.cards.photo_source is
  'Ключ в content_source. Выводится из хоста ссылки — не заполняется вручную.';

-- Заполнение источника фото: чистый вывод из ссылки, ничего не угадывается.
update public.cards
   set photo_source = public.content_source_of_url(photo_url)
 where photo_url is not null and photo_url <> ''
   and photo_source is distinct from public.content_source_of_url(photo_url);

-- ⚠️ ОПИСАНИЯ ПРОСТАВЛЯЮТСЯ ТОЛЬКО ИГРОКАМ, И ЭТО НЕ ЛЕНЬ.
-- Собирает их `docs/cards_descriptions_build.py`, и он пишет ТОЛЬКО в пустую
-- карточку — ручную заметку он не трогает. У игроков до его первого прогона
-- описаний не было ни одного (замер записан в шапке самого сборщика), значит
-- всякое описание игрока — из Википедии. У клубов, стадионов и терминов часть
-- написана руками, и отличить их в данных уже нечем: поставить всем
-- «Википедия» значило бы приписать источнику чужой текст. Эти строки остаются
-- пустыми, ревизия их считает, и разбирает человек.
update public.cards
   set descriptions_source = 'wikipedia'
 where category = 'player'
   and descriptions is not null and descriptions <> '{}'::jsonb
   and descriptions_source is null;

-- Сборщику подписей нужен ровно этот срез: снимки с Викисклада.
create index if not exists cards_commons_photo_idx
  on public.cards (photo_url)
  where photo_source = 'wikimedia_commons';

-- ⚠️ ИСТОЧНИК ПРОСТАВЛЯЕТСЯ САМ, А НЕ ШАГОМ КОНВЕЙЕРА. Разовое заполнение
-- выше закрывает то, что уже лежит; новые карточки приходят каждую ночь
-- (`run.py --cards-photos`), и происхождение, которое надо не забыть
-- поставить, однажды забудут — а выглядеть это будет как «снимок ничей».
-- Триггер стоит копейки (один поиск по таблице из тридцати строк) и снимает
-- вопрос навсегда: ссылка есть — источник известен.
create or replace function public.cards_set_photo_source()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.photo_source := public.content_source_of_url(new.photo_url);
  return new;
end $$;

drop trigger if exists cards_photo_source_trg on public.cards;
create trigger cards_photo_source_trg
  before insert or update of photo_url on public.cards
  for each row execute function public.cards_set_photo_source();

-- ---------------------------------------------------------------------------
-- 7. Ревизия прав: одна строка на «колонка × источник».
--
-- ⚠️ РЕВИЗИЯ ИЩЕТ КОЛОНКИ САМА, А НЕ ПО СПИСКУ. Список устарел бы молча —
-- ровно так в этом проекте разошлись «семь Edge-функций» (их девять) и
-- «остальные семь тестов» (их полтора десятка). Здесь сканируется
-- information_schema: всякая таблица с колонкой `source`, `*_source`,
-- `photo_url`, `crest_url` или `image_url` попадает в ревизию сама, а новый
-- сборщик не может завести себе таблицу и остаться незамеченным.
--
-- ⚠️ ПРЕДСТАВЛЕНИЯ ПРОПУСКАЮТСЯ НАМЕРЕННО (`table_type = 'BASE TABLE'`).
-- `player_match_days` и `player_talent_queue` — виды поверх уже учтённых
-- `player_match_stats` и `soccerwiki_player`; учесть их значило бы посчитать
-- один и тот же материал дважды и раздуть итог вдвое.
-- ---------------------------------------------------------------------------
-- ⚠️ `p_with_credits` — ЭТО ЦЕНА ОТВЕТА, А НЕ УДОБСТВО. Проверка «у всего ли
-- известен источник» не нуждается в поиске подписи к каждому файлу, а поиск
-- этот стоит отдельного прохода по `media_credit`. Замер: полная ревизия
-- ~6 с, без подписей ~5 с; обе живут под сервисным ключом, где потолка в три
-- секунды нет.
-- ⚠️ СНАЧАЛА DROP: у функции появился параметр, а `create or replace` с новой
-- сигнатурой завёл бы ВТОРУЮ функцию рядом со старой. Две ревизии под одним
-- именем — это вызов без аргумента, уходящий в прошлую версию.
drop function if exists public.content_rights_audit();

create or replace function public.content_rights_audit(p_with_credits boolean default true)
returns table(area text, source_key text, license text, attribution text,
              license_ok boolean, records bigint, missing_credit bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  r          record;
  v_override text;
  v_missing  text;
  v_sql      text;
begin
  for r in
    select c.table_name  as tbl,
           c.column_name as col,
           case when c.column_name in ('photo_url', 'crest_url', 'image_url')
                then 'host' else 'label' end as kind
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name   = c.table_name
       and t.table_type   = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.table_name not like '\_bak\_%'
       and (c.column_name in ('source', 'photo_url', 'crest_url', 'image_url')
            or c.column_name like '%\_source')
       -- `photo_source` выводится из `photo_url`: считать обе значило бы
       -- задвоить одни и те же снимки.
       and c.column_name <> 'photo_source'
       -- Сама таблица подписей — не контент.
       and c.table_name <> 'media_credit'
     order by c.table_name, c.column_name
  loop
    select o.source_key into v_override
      from public.content_origin o
     where o.kind = 'column' and o.token = r.tbl || '.' || r.col;

    -- Подпись у файла ищется в `media_credit` по самой ссылке, поэтому
    -- отвечает одинаково и для карточки, и для кэша, и для players_meta:
    -- файл один, подпись одна.
    if r.kind = 'host' and p_with_credits then
      v_missing := format(
        'not exists (select 1 from public.media_credit m where m.url = x.%I)', r.col);
    elsif r.kind = 'host' then
      v_missing := 'false';
    else
      v_missing := 'true';
    end if;

    if v_override is not null then
      v_sql := format(
        'select %L::text, count(*)::bigint, count(*) filter (where %s)::bigint
           from public.%I x where x.%I is not null and x.%I::text <> %L',
        v_override, v_missing, r.tbl, r.col, r.col, '');
    elsif r.kind = 'host' then
      -- ⚠️ ЧЕРЕЗ ФУНКЦИЮ, А НЕ ЧЕРЕЗ JOIN ПО ХОСТУ. Правило разрешения ссылки
      -- одно на весь проект (см. историю с upload.wikimedia.org выше), и
      -- второй его записи здесь быть не должно: разъехавшись, они дали бы
      -- `cards.photo_source` одно, а ревизии другое — про один и тот же файл.
      v_sql := format(
        'select public.content_source_key(x.%I),
                count(*)::bigint, count(*) filter (where %s)::bigint
           from public.%I x
          where x.%I is not null and x.%I <> %L
          group by 1',
        r.col, v_missing, r.tbl, r.col, r.col, '');
    else
      v_sql := format(
        'select o.source_key, count(*)::bigint, count(*) filter (where %s)::bigint
           from public.%I x
           left join public.content_origin o
             on o.kind = ''label'' and o.token = x.%I::text
          where x.%I is not null
          group by 1',
        v_missing, r.tbl, r.col, r.col);
    end if;

    area := r.tbl || '.' || r.col;
    for source_key, records, missing_credit in execute v_sql
    loop
      select s.license, s.attribution, s.license_ok
        into license, attribution, license_ok
        from public.content_source s where s.key = source_key;
      -- Подпись у каждой записи нужна только там, где её требует лицензия.
      if attribution is distinct from 'per_record' then
        missing_credit := 0;
      end if;
      return next;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Только то, что требует решения.
--
-- Три вида беды, и они разные:
--
--   'источник не опознан'  — сборщик пишет метку или хост, которых нет в
--                            мосте. Пока это так, про эти записи мы не можем
--                            сказать вообще ничего.
--   'нет подписи'          — лицензия требует назвать автора у каждого файла,
--                            а автора мы не спросили.
--   'нет лицензии'         — показываем, не имея разрешения.
-- ---------------------------------------------------------------------------
create or replace function public.content_rights_gaps()
returns table(problem text, area text, source_key text, records bigint)
language sql stable security definer set search_path = public as $$
  select case
           when a.source_key is null then 'источник не опознан'
           when a.missing_credit > 0 then 'нет подписи'
           else                           'нет лицензии'
         end,
         a.area,
         coalesce(a.source_key, '—'),
         -- Число — про саму беду: сколько записей не опознано, сколько без
         -- подписи, сколько показывается без разрешения.
         case when a.source_key is null then a.records
              when a.missing_credit > 0 then a.missing_credit
              else a.records end
    from public.content_rights_audit(true) a
   where a.source_key is null or a.missing_credit > 0 or not a.license_ok
   order by 1, 4 desc;
$$;

-- ---------------------------------------------------------------------------
-- 9. Что видно снаружи.
--
-- ⚠️ РЕЕСТР ЧИТАЕТСЯ ВСЕМИ НАМЕРЕННО. Подпись, которую видно только штату,
-- подписью не является: экран «Источники» строится ровно из этой таблицы.
--
-- ⚠️ А ВОТ РЕВИЗИЯ — НЕТ. Она отвечает «5335 снимков показываются без
-- разрешения», и это про нас, а не про контент. Наружу уходит только
-- `content_rights_unresolved()`: она говорит «мы не знаем, чьё это»,
-- и именно её спрашивает check-prod.
-- ---------------------------------------------------------------------------
alter table public.content_source enable row level security;
alter table public.content_origin enable row level security;

drop policy if exists content_source_read on public.content_source;
create policy content_source_read on public.content_source for select using (true);
drop policy if exists content_origin_read on public.content_origin;
create policy content_origin_read on public.content_origin for select using (true);

alter table public.media_credit enable row level security;
drop policy if exists media_credit_read on public.media_credit;
create policy media_credit_read on public.media_credit for select using (true);

grant select on public.content_source, public.content_origin, public.media_credit
  to anon, authenticated;
grant select, insert, update, delete
  on public.content_source, public.content_origin, public.media_credit to service_role;

-- Подписи к показанным сейчас снимкам — одним запросом, без обхода таблицы.
create or replace function public.media_credit_for(p_urls text[])
returns table(url text, author text, license text, license_url text, credit_url text)
language sql stable security definer set search_path = public as $$
  select m.url, m.author, m.license, m.license_url, m.credit_url
    from public.media_credit m
   where m.url = any(p_urls);
$$;

grant execute on function public.media_credit_for(text[]) to anon, authenticated, service_role;

create or replace function public.content_rights_unresolved()
returns table(area text, records bigint)
language sql stable security definer set search_path = public as $$
  select a.area, a.records
    from public.content_rights_audit(false) a
   where a.source_key is null
   order by a.records desc;
$$;

-- ⚠️ РЕВИЗИЯ — ВНУТРЕННЯЯ, И ПРИЧИН ТОМУ ДВЕ. Первая: она отвечает
-- «5335 снимков показываются без разрешения» — это утверждение про нас.
-- Вторая нашлась замером: полный проход по всем таблицам с контентом стоит
-- около шести секунд, а у роли anon потолок запроса ТРИ. Отданная анониму,
-- она отвечала бы 57014 и вдобавок раздавала бы по шесть секунд процессорного
-- времени на запрос кому угодно.
revoke all on function public.content_rights_audit(boolean) from public, anon, authenticated;
revoke all on function public.content_rights_gaps()         from public, anon, authenticated;
revoke all on function public.content_rights_unresolved()   from public, anon, authenticated;
revoke all on function public.content_source_key(text)      from public, anon, authenticated;
grant execute on function public.content_rights_audit(boolean) to service_role;
grant execute on function public.content_rights_gaps()         to service_role;
grant execute on function public.content_rights_unresolved()   to service_role;
grant execute on function public.content_source_key(text)      to service_role;

-- А это игроку нужно: подпись под снимком и вопрос «чей этот файл».
grant execute on function public.content_source_of_url(text)   to anon, authenticated, service_role;
grant execute on function public.content_source_of_label(text) to anon, authenticated, service_role;

-- Панель персонала: полная ревизия за тем же паролем, что и остальная панель.
create or replace function public.admin_content_rights(p_password text)
returns table(problem text, area text, source_key text, records bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not admin_check_password(p_password) then
    raise exception 'нет доступа' using errcode = '42501';
  end if;
  return query select * from public.content_rights_gaps();
end $$;

grant execute on function public.admin_content_rights(text) to anon, authenticated, service_role;
