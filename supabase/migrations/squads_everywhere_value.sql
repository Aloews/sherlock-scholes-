-- ===========================================================================
-- СОСТАВ У КАЖДОЙ КОМАНДЫ, И В НЁМ — СТОИМОСТЬ, А НЕ НАШ РЕЙТИНГ.
--
-- Владелец: «Нужно чтобы у всех команды была функция „показать состав“ и в
-- ней пиши стоимость игрока, а не наш рейтинг, у нашего рейтинга все
-- футболисты имеют по 100. Стоимость точнее отражает уровень игрока»; и
-- отдельно — «в прогнозах доделай все составы».
--
-- Здесь три части, и они связаны: без первой третья всё равно молчала бы.
--
--   1. Псевдонимы: имена команд ИЗ РАСПИСАНИЯ, которые не доходили до клуба.
--   2. `club_squad_view` — ОДИН ответ «кто играет за этот клуб».
--   3. `fixture_squads` — две стороны матча, собранные ИМ ЖЕ.
--
-- ⚠️ ОДИН ИСТОЧНИК СОСТАВА НА ВСЮ ИГРУ, И ЭТО НЕ КРАСИВОСТЬ. Экран матча и
-- экран команды показывали разное: первый шёл в `club_squad` (наши карточки),
-- второй умел ещё и заявку с Transfermarkt. Две функции, отвечающие на один
-- вопрос, расходятся молча — и разошлись: у «Брайтона» в заявке 30 человек, а
-- под матчем не было ни одного.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ПСЕВДОНИМЫ ИЗ РАСПИСАНИЯ.
--
-- Замер 12.09.2026: из 200 ближайших матчей состав обеих сторон находился у
-- 113. У остальных хотя бы одна сторона не доходила до клуба ВОВСЕ — при том
-- что заявка у клуба есть: «Brighton and Hove Albion» из the-odds-api даёт
-- ключ «brighton and hove albion», а заявка на 30 человек лежит под
-- «brighton hove albion».
--
-- ⚠️ ПИШЕМ В `club_alias_seed`, А НЕ В `club_alias`. `build_club_aliases()`
-- НАЧИНАЕТСЯ С `delete from club_alias` и собирает таблицу заново — всё, что
-- вписано в неё руками, живёт до первого ночного пересбора справочника.
-- Именно так под ударом оказались четыре строки из `club_alias_accents.sql`;
-- они перенесены сюда же, в seed, где их никто не сотрёт.
--
-- ⚠️ КАЖДАЯ ПАРА ПРОВЕРЕНА ПО ТУРНИРУ, А НЕ ПО ПОХОЖЕСТИ СТРОК. Похожесть
-- (pg_trgm) только предлагала; решала страна клуба против лиги матча. Так
-- отсеяны, и это не гипотетические промахи, а то, что предлагал перебор:
--
--   Armenia, Austria, Portugal, Romania — Лига наций, это СБОРНЫЕ, а не
--       «Арарат-Армения», «Аустрия Вена», «Португеса» и «Рома»;
--   Deportivo La Coruña (Испания) → «Депортиво Ла-Гуайра» (Венесуэла);
--   Fortuna Sittard (Нидерланды) → «Фортуна» (Германия);
--   JEF United Chiba (Япония)    → «Чеджу Юнайтед» (Корея);
--   Independiente del Valle (Эквадор), Independiente Rivadavia (Мендоса),
--       Independiente Santa Fe (Колумбия) — три РАЗНЫХ клуба, и ни один из
--       них не «Индепендьенте» из Авельянеды;
--   Estudiantes (Примера) → «Эстудиантес де Рио-Куарто» (лигой ниже);
--   Vitoria (Бразилия) → «Витория С.К.» (Гимарайнш, Португалия).
--
-- Пустая строка в scope значит «во всех странах»: имя из расписания приходит
-- без страны вовсе.
-- ---------------------------------------------------------------------------
insert into club_alias_seed (alias_key, scope, club_key, note) values
  (club_norm_key('Atletico Mineiro'),              '', 'clube atl tico mineiro',    'расписание: Бразилия'),
  (club_norm_key('Auxerre'),                       '', 'aj auxerre',                'расписание: Лига 1'),
  (club_norm_key('Bragantino-SP'),                 '', 'red bull bragantino',       'расписание: Бразилия'),
  (club_norm_key('Brighton and Hove Albion'),      '', 'brighton hove albion',      'расписание: АПЛ'),
  (club_norm_key('CA Tigre BA'),                   '', 'tigre',                     'расписание: Аргентина'),
  (club_norm_key('CF Montreal'),                   '', 'montr al',                  'расписание: MLS'),
  (club_norm_key('Corinthians-SP'),                '', 'corinthians',               'расписание: Либертадорес'),
  (club_norm_key('FC Zwolle'),                     '', 'pec zwolle',                'расписание: Эредивизи'),
  (club_norm_key('Fenerbahce'),                    '', 'fenerbah e',                'расписание: Турция'),
  (club_norm_key('Ferencváros TC'),                '', 'ferencv rosi tc',           'расписание: Лига Европы'),
  (club_norm_key('Flamengo-RJ'),                   '', 'cr flamengo',               'расписание: Либертадорес'),
  (club_norm_key('Fluminense-RJ'),                 '', 'fluminense',                'расписание: Либертадорес'),
  (club_norm_key('FSV Mainz 05'),                  '', '1 fsv mainz 05',            'расписание: Бундеслига'),
  (club_norm_key('Gazişehir Gaziantep'),           '', 'gaziantep',                 'расписание: Турция'),
  (club_norm_key('Heerenveen'),                    '', 'herenven',                  'расписание: Эредивизи'),
  (club_norm_key('Hiroshima Sanfrecce FC'),        '', 'sanfrechche hirosima',      'расписание: Джей-лига'),
  (club_norm_key('Independiente'),                 '', 'atl tico independiente',    'расписание: Аргентина, Примера'),
  (club_norm_key('Kryliya Sovetov'),               '', 'pfc krylia sovetov samara', 'расписание: РПЛ'),
  (club_norm_key('Palmeiras-SP'),                  '', 'se palmeiras',              'расписание: Либертадорес'),
  (club_norm_key('Pumas'),                         '', 'pumas unam',                'расписание: Лига MX'),
  (club_norm_key('Real Racing Club de Santander'), '', 'racing de santander',       'расписание: Испания'),
  (club_norm_key('Rosario Central'),               '', 'rosario sentral',           'расписание: Аргентина'),
  (club_norm_key('Santa Clara'),                   '', 'santa klara',               'расписание: Португалия'),
  (club_norm_key('Sao Paulo'),                     '', 's o paulo',                 'расписание: Бразилия'),
  (club_norm_key('Sporting Lisbon'),               '', 'sporting cp',               'расписание: Португалия'),
  (club_norm_key('Tijuana'),                       '', 'tihuana',                   'расписание: Мексика'),
  (club_norm_key('Torku Konyaspor'),               '', 'konyaspor',                 'расписание: Турция'),
  (club_norm_key('Ulsan Hyundai FC'),              '', 'ulsan hd',                  'расписание: Корея'),
  (club_norm_key('Velez Sarsfield BA'),            '', 'veles sarsfild',            'расписание: Аргентина'),
  -- Спасённые из club_alias_accents.sql: там они лежали в club_alias и
  -- пережили бы ровно один пересбор справочника.
  (club_norm_key('Bayern München'),                '', 'bayern munich',             'ü съедается ключом'),
  (club_norm_key('Bayern Munchen'),                '', 'bayern munich',             'то же имя без умляута'),
  (club_norm_key('Olympique Marseille'),           '', 'olympique de marseille',    'ключ без «de»'),
  (club_norm_key('Inter Milan'),                   '', 'internazionale',            'двойник из расписания')
on conflict (alias_key, scope) do update
  set club_key = excluded.club_key, note = excluded.note;

-- Чтобы заработало сейчас, а не после ночного пересбора.
insert into club_alias (alias_key, scope, club_key, source)
select s.alias_key, s.scope, s.club_key, 'seed' from club_alias_seed s
on conflict (alias_key, scope) do update
  set club_key = excluded.club_key, source = excluded.source;

-- И тот же шаг, что делает build_club_aliases: если seed говорит «X это Y», то
-- ВСЁ, что вело на X, ведёт теперь на Y. Без него «Брайтон» остался бы
-- расколотым по другим написаниям.
update club_alias a
   set club_key = s.club_key
  from club_alias_seed s
 where s.scope = '' and a.club_key = s.alias_key and a.club_key <> s.club_key;

-- ---------------------------------------------------------------------------
-- 2. СОСТАВ КЛУБА — ОДИН ОТВЕТ ИЗ ТРЁХ ИСТОЧНИКОВ ПО СТАРШИНСТВУ.
--
-- Порядок источников — по тому, сколько они знают, а не по тому, чей он:
--
--   roster     заявка с Transfermarkt: 866 клубов, у каждого игрока цена;
--   cards      наши карточки: 1159 клубов, цена есть не у всех;
--   soccerwiki состав Soccer Wiki: ещё 80 клубов сверх первых двух, цен нет.
--
-- ⚠️ ИСТОЧНИКИ НЕ СМЕШИВАЮТСЯ, А ВЫБИРАЕТСЯ ПЕРВЫЙ НЕПУСТОЙ. Объединение
-- давало бы одного человека дважды под двумя написаниями — ровно та жалоба,
-- что уже была про «Алексиса Вегу».
--
-- ⚠️ `source` ОТДАЁТСЯ НАРУЖУ НАМЕРЕННО: «состав из заявки клуба» и «состав из
-- наших карточек» — разные утверждения, и экран обязан их различать.
--
-- ⚠️ ИМЯ ОТДАЁТСЯ ДВУМЯ КОЛОНКАМИ, а выбирает язык клиент (shared/lib/
-- cardName.ts). У заявки имя латиницей, у карточки — кириллицей; какое из них
-- показать, решает одно правило в одном месте, а не три экрана по-своему.
-- ---------------------------------------------------------------------------
drop function if exists public.club_squad_view(text, integer);
create or replace function public.club_squad_view(
  p_club_key text,
  p_limit    integer default 40
)
returns table (
  card_id          uuid,
  name             text,
  name_en          text,
  market_value_eur bigint,
  player_position  text,
  shirt_number     smallint,
  photo_url        text,
  source           text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with roster as (
    select r.card_id,
           coalesce(c.name, r.name)                         as name,
           coalesce(c.name_en, r.name)                      as name_en,
           coalesce(r.market_value_eur, c.market_value_eur) as market_value_eur,
           r.position                                       as player_position,
           r.shirt_number,
           c.photo_url,
           'roster'::text                                   as source
      from club_roster r
      left join cards c on c.id = r.card_id and c.active
     where r.club_key = p_club_key
  ),
  ours as (
    select q.card_id, c.name, c.name_en, c.market_value_eur,
           q.position, q.shirt_number, c.photo_url, 'cards'::text
      from club_squad q
      join cards c on c.id = q.card_id and c.active and c.category = 'player'
     where q.club_key = p_club_key and q.left_at is null
  ),
  wiki as (
    select p.card_id,
           coalesce(c.name, p.name), coalesce(c.name_en, p.name),
           c.market_value_eur,
           p.position, nullif(p.shirt_number, 0)::smallint,
           coalesce(c.photo_url, p.photo_url), 'soccerwiki'::text
      from soccerwiki_player p
      join soccerwiki_club sc on sc.club_id = p.club_id
      left join cards c on c.id = p.card_id and c.active
     where sc.club_key = p_club_key
  )
  select * from roster
  union all
  select * from ours where not exists (select 1 from roster)
  union all
  select * from wiki where not exists (select 1 from roster)
                       and not exists (select 1 from ours)
  -- ⚠️ ПОРЯДОК — НОМЕРАМИ КОЛОНОК, А НЕ ИМЕНАМИ. У функции с `returns table`
  -- имена колонок это ещё и выходные параметры, и неквалифицированное `name`
  -- в ORDER BY читается как ссылка сразу на два разных — «column reference is
  -- ambiguous». Внутри CTE помогает префикс таблицы, над UNION его не бывает.
   order by 4 desc nulls last, 2
   limit greatest(1, least(coalesce(p_limit, 40), 60));
$function$;

comment on function public.club_squad_view(text, integer) is
  'Состав клуба одним ответом: заявка Transfermarkt, иначе наши карточки, иначе Soccer Wiki. Цена в евро, имя двумя написаниями.';

grant execute on function public.club_squad_view(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. ДВЕ СТОРОНЫ МАТЧА — ТЕМ ЖЕ ИСТОЧНИКОМ.
--
-- ⚠️ СТАРЫЕ КОЛОНКИ (`level`, `basis`, `in_rating`) ОСТАЮТСЯ, ХОТЯ ЭКРАН ИХ
-- БОЛЬШЕ НЕ ПОКАЗЫВАЕТ. Выкаченный фронтенд читает их прямо сейчас, а
-- открытое мини-приложение не перезагружается от того, что мы собрали новую
-- сборку. Удаление того, что зовёт прод, один раз уже роняло это приложение —
-- см. легаси-шим pick_random_cards. Убрать их можно, когда новая сборка
-- разойдётся везде.
--
-- ⚠️ `level` ТЕПЕРЬ БЫВАЕТ ПУСТЫМ, и это честнее прежнего: у игрока из заявки
-- может не быть нашей карточки вовсе, а значит и уровня. Прежде такие люди
-- просто не показывались.
-- ---------------------------------------------------------------------------
drop function if exists public.fixture_squads(text, text);
create or replace function public.fixture_squads(
  p_fixture_id text,
  p_lang       text default 'ru'
)
returns table (
  side             text,
  club_key         text,
  club             text,
  card_id          uuid,
  name             text,
  name_en          text,
  market_value_eur bigint,
  player_position  text,
  shirt_number     smallint,
  photo_url        text,
  source           text,
  level            smallint,
  basis            text,
  in_rating        boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with fx as (
    select f.id,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f where f.id = p_fixture_id
  ),
  sides as (
    select 'home'::text as side, fx.hk as club_key from fx
    union all
    select 'away', fx.ak from fx
  ),
  ranked as (
    select s.side, s.club_key, v.*,
           row_number() over (partition by s.side
                              order by v.market_value_eur desc nulls last, v.name) as rn
      from sides s
      cross join lateral club_squad_view(s.club_key, 40) v
  ),
  depth as (
    -- Префиксы обязательны: `side` — ещё и выходной параметр функции.
    select least((select count(*) from ranked rk where rk.side = 'home'),
                 (select count(*) from ranked rk where rk.side = 'away'), 11) as n
  )
  select r.side, r.club_key, club_display_name(r.club_key, p_lang),
         r.card_id, r.name, r.name_en, r.market_value_eur,
         r.player_position, r.shirt_number, r.photo_url, r.source,
         l.level, l.basis,
         r.rn <= (select n from depth)
    from ranked r
    left join player_level l on l.card_id = r.card_id
   order by r.side desc, r.market_value_eur desc nulls last, r.name;
$function$;

comment on function public.fixture_squads(text, text) is
  'Составы обеих сторон матча через club_squad_view: стоимость игрока, имя двумя написаниями, источник назван.';

grant execute on function public.fixture_squads(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ССЫЛКА НА КЛУБ ВЕДЁТ НА ЭКРАН КОМАНДЫ, А НЕ В КАРТОЧКУ.
--
-- Владелец: «при нажатии на клуб на всех экранах ссылайся на „команды и
-- статистика“, а в „коллекциях“ убери „клубы“ — там мало данных и нет
-- составов».
--
-- ⚠️ ПОЭТОМУ `clubs_by_names` БОЛЬШЕ НЕ ТРЕБУЕТ КАРТОЧКИ. Условие
-- `card_id is not null` стояло ровно потому, что ссылка вела В КАРТОЧКУ:
-- клуб без неё вёл бы в пустоту. Теперь ссылка ведёт на экран команды, а он
-- есть у клуба и без карточки — и таких большинство: карточек 430, клубов
-- в справочнике 2097. `card_id` по-прежнему отдаётся: он ещё нужен тем, кто
-- рисует карточку рядом.
-- ---------------------------------------------------------------------------
create or replace function public.clubs_by_names(p_names text[])
returns table (name text, club_key text, card_id uuid, crest_url text)
language sql stable security definer set search_path to 'public'
as $function$
  select n.name, fc.club_key, fc.card_id, fc.crest_url
    from unnest(coalesce(p_names, '{}'::text[])) as n(name)
    left join football_club fc on fc.club_key = resolve_club_key(n.name, null);
$function$;
