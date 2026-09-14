-- ============================================================================
-- ВИСЯЧИЕ ССЫЛКИ НА КЛУБЫ: 34 → 0. Семь переименований и двадцать клубов,
-- которых у нас просто не было.
--
-- Продолжение `club_alias_dangling_fix.sql`. Там висячих стало 46 → 34, а
-- остаток был оставлен владельцу с двумя вариантами: разрешить NULL в
-- `card_current_club.club_key` либо завести недостающие клубы в справочнике.
-- Здесь сделан ВТОРОЙ вариант — потому что при разборе остатка нашлось то,
-- чего в прошлый раз не увидели.
--
-- ЧТО НАШЛОСЬ. Прошлая записка утверждала, что «Реал Сосьедад Б»,
-- «Вильярреал Б» и «Бильбао Атлетик» чинить нечем: свести их на основную
-- команду нельзя (это была бы ошибка «Челси под Страсбуром»), а своих строк у
-- них нет. Своих строк у них нет только под латинским ключом. В справочнике
-- они лежат ПОД ТРАНСЛИТЕРИРОВАННЫМ РУССКИМ:
--
--     real sociedad b  (висит)   ←→  real sosedad b = «Реал Сосьедад Б»
--     villarreal b     (висит)   ←→  vilyarreal b   = «Вильярреал Б»
--     bilbao athletic  (висит)   ←→  atletik b      = «Атлетик Б»
--
-- Это не сведение дубля на основную команду, а сведение ДВУХ НАПИСАНИЙ ОДНОГО
-- И ТОГО ЖЕ ДУБЛЯ. Игроки «Вильярреала Б» попадают в состав «Вильярреала Б».
--
-- ⚠️ ИЩИТЕ РУССКИЙ ТРАНСЛИТ, ПРЕЖДЕ ЧЕМ ЗАВОДИТЬ КЛУБ ЗАНОВО. Подстрочный
-- поиск по латинскому ключу их не находит: `villarreal b` и `vilyarreal b` не
-- имеют общей подстроки длиннее «vil». Именно поэтому прошлый разбор их
-- пропустил и назвал «клубами, которых у нас нет вовсе».
--
-- ЕЩЁ ЧЕТЫРЕ — ПЕРЕИМЕНОВАНИЯ, А НЕ РАЗНЫЕ КЛУБЫ:
--     Daejeon Hana Citizen  = Daejeon Citizen  (переименован в 2020)
--     Chungbuk Cheongju FC  = Cheongju FC      (переименован при выходе в K2)
--     Dynamo Moscow         = dinamo moscow    («Динамо», name_en Dynamo Moskva)
--     Al Duhail             = al duhayl        («Аль-Духайль», Катар)
--
-- ДВАДЦАТЬ ОСТАВШИХСЯ ЗАВЕДЕНЫ В СПРАВОЧНИК. Это настоящие клубы, которых у
-- нас не было ни под каким написанием: дубли без своей строки (Барселона,
-- Шальке, Алавес, Бетис, Ланс, Бавария, Порту) и клубы низших и неевропейских
-- лиг. Каждый сверен по игроку карточки: Ип Хунфай — вратарь Гонконга, значит
-- «Eastern» здесь гонконгский; Ахмед Муса — Kano Pillars, Нигерия; Джулиан
-- Грин играл за «Баварию II».
--
-- ⚠️ КЛЮЧИ ОСТАВЛЕНЫ ТАКИМИ, КАКИМИ ИХ ДЕЛАЕТ ПАЙПЛАЙН, вместе с увечьями от
-- срезания диакритик: `alav s b` («Alavés B»), `alcorc n` («Alcorcón»),
-- `portu b`, `bavariya ii`. Ключ внутренний, на экране его нет, а «починенный»
-- ключ разошёлся бы с тем, что построит `club_match_key` при следующем сборе,
-- и связь висела бы снова.
--
-- ⚠️ ЗАПОЛНЕНЫ ТОЛЬКО ИМЯ И СТРАНА. Лига не ставится намеренно: дубли и клубы
-- низших лиг ходят вверх-вниз каждый сезон, а записанный руками дивизион
-- устаревает молча. Эмблему, лигу и состав дотянет ночной обход — в
-- справочнике и так 1142 клуба без эмблемы и 1457 без состава, это его работа.
--
-- ⚠️ ПОБОЧНАЯ НАХОДКА ИЗ ПРОШЛОГО РАЗБОРА ОСТАЁТСЯ В СИЛЕ: транслит уже завёл
-- двойников внутри самого справочника — `besiktas jk` и `be ikta jk`,
-- `real sociedad ii` и `real sosedad b`, `stuttgart ii` и `shtutgart 2`,
-- `willem ii` и `willem ii tilburg`. Здесь они не сводятся: склейка удаляет
-- строку справочника, а это отдельная работа со своими ссылками.
-- ============================================================================

-- 1. Семь написаний одного и того же клуба.
--
-- ⚠️ ПИШЕТСЯ В `club_alias_seed`, А НЕ В `club_alias`. `build_club_aliases()`
-- начинается с `delete from club_alias` и собирает таблицу заново; вписанное
-- прямо в неё живёт до ближайших 06:25. Разбор — в
-- `club_fix_survives_rebuild.sql`, там же спасены десять таких же строк из
-- предыдущей миграции.
insert into club_alias_seed (alias_key, scope, club_key, note) values
  ('dynamo moscow',        '', 'dinamo moscow',   'одна команда, два написания'),
  ('al duhail',            '', 'al duhayl',       'одна команда, два написания'),
  ('real sociedad b',      '', 'real sosedad b',  'дубль под русским транслитом'),
  ('villarreal b',         '', 'vilyarreal b',    'дубль под русским транслитом'),
  ('bilbao athletic',      '', 'atletik b',       'дубль под русским транслитом'),
  ('daejeon hana citizen', '', 'daejeon citizen', 'переименован в 2020'),
  ('chungbuk cheongju',    '', 'cheongju',        'переименован при выходе в K2')
on conflict (alias_key, scope) do nothing;

-- 2. Двадцать клубов, которых в справочнике не было.
insert into football_club (club_key, name, name_en, country, kind) values
  ('alav s b',           'Alavés B',            'Alavés B',            'Испания',    'club'),
  ('alcorc n',           'AD Alcorcón',         'AD Alcorcón',         'Испания',    'club'),
  ('arenteiro',          'CD Arenteiro',        'CD Arenteiro',        'Испания',    'club'),
  ('barcelona b',        'Barcelona Atlètic',   'Barcelona Atlètic',   'Испания',    'club'),
  ('betis deportivo',    'Betis Deportivo',     'Betis Deportivo',     'Испания',    'club'),
  ('bavariya ii',        'Bayern Munich II',    'Bayern Munich II',    'Германия',   'club'),
  ('schalke 04 ii',      'Schalke 04 II',       'Schalke 04 II',       'Германия',   'club'),
  ('lens b',             'RC Lens B',           'RC Lens B',           'Франция',    'club'),
  ('c chartres',         'C''Chartres Football','C''Chartres Football','Франция',    'club'),
  ('portu b',            'FC Porto B',          'FC Porto B',          'Португалия', 'club'),
  ('nankatsu',           'Nankatsu SC',         'Nankatsu SC',         'Япония',     'club'),
  ('zweigen kanazawa',   'Zweigen Kanazawa',    'Zweigen Kanazawa',    'Япония',     'club'),
  ('bg pathum united',   'BG Pathum United',    'BG Pathum United',    'Таиланд',    'club'),
  ('dewa united banten', 'Dewa United Banten',  'Dewa United Banten',  'Индонезия',  'club'),
  ('eastern',            'Eastern',             'Eastern',             'Гонконг',    'club'),
  ('kano pillars',       'Kano Pillars',        'Kano Pillars',        'Нигерия',    'club'),
  ('saprissa',           'Deportivo Saprissa',  'Deportivo Saprissa',  'Коста-Рика', 'club'),
  ('brooklyn',           'Brooklyn FC',         'Brooklyn FC',         'США',        'club'),
  ('empire strykers',    'Empire Strykers',     'Empire Strykers',     'США',        'club'),
  ('wollongong wolves',  'Wollongong Wolves',   'Wollongong Wolves',   'Австралия',  'club')
on conflict (club_key) do nothing;

-- 3. Пересобрать псевдонимы из seed и связь карточка → клуб, чтобы пункт 1
--    лёг в `card_current_club.club_key`. Без этого шага семь строк остались бы
--    висеть: ключ там уже записан, сам он не пересчитается.
select build_club_aliases();
select rebuild_card_current_clubs();

-- 4. Проверка: обязана вернуть ноль по всем пяти видам ссылок.
select * from orphan_club_refs();
