-- ============================================================================
-- СПРАВОЧНИК ФУТБОЛЬНЫХ КЛУБОВ, СОСТАВЫ И КОМАНДНАЯ СТАТИСТИКА
--
-- ЧЕГО ЗДЕСЬ РАНЬШЕ НЕ БЫЛО ВООБЩЕ. Таблица `teams` в этой базе — команды
-- игровой комнаты Элиаса (`id, room_id, name, color`), к футболу отношения не
-- имеет. Настоящие клубы существовали только как ВЫВОДИМАЯ `card_current_club`
-- — по одной строке на игрока, без имени, страны, лиги и эмблемы. Спросить
-- «что это за клуб» было не у кого.
--
-- ЗАМЕР, С КОТОРОГО ВСЁ НАЧАЛОСЬ (30.08.2026, боевая база):
--   карточек игроков                 2918
--   из них с клубом                  1252  (43%)
--   клубов всего                      299
--   клубов, где есть хотя бы 11        39   ← состав можно показать у 39 из 299
--
-- ⚠️ И ЭТО НЕ ГЛАВНОЕ ЧИСЛО. Состав — не единственное, что делает экран
-- команды: у нас лежит 30 880 строк матчевой статистики sports.ru, и в каждой
-- есть home_team, away_team и счёт. Свёрнутые до матча, они дают
--   7136 матчей с 2008 года, 1563 команды, у 552 из них ≥5 матчей.
-- То есть таблица результатов, форма и бомбардиры работают у 552 команд, а не
-- у 39. Экран, построенный ТОЛЬКО на составах, показывал бы пустоту там, где
-- данные есть.
--
-- ⚠️ ЛОВУШКА, КОТОРАЯ ДЕРЖАЛА ВСЁ ЭТО ЗАКРЫТЫМ. `club_match_key()` вырезает
-- всё, кроме [a-z0-9], поэтому на кириллице отдаёт NULL:
--     club_match_key('Zenit St Petersburg') → 'zenit st petersburg'
--     club_match_key('Зенит')               → NULL
-- А источники пишут разными алфавитами: sports.ru (30 880 строк, по-русски),
-- ESPN (1061 строка, по-английски), the-odds-api в `fixtures` (латиница),
-- карточки клубов (`name` по-русски, `name_en` по-английски). Из-за этого
-- `fill_missing_clubs()` возвращала ноль, и это записано в шапке
-- `stats_dedupe_and_namesakes.sql` как незакрытая дыра.
--
-- ЧИНИТСЯ ДВУМЯ РАЗНЫМИ ВЕЩАМИ, И ИХ ВАЖНО НЕ ПУТАТЬ:
--   1. `club_norm_key()` — НОРМАЛИЗАТОР. Транслитерирует и чистит аффиксы,
--      чтобы у кириллического названия ВООБЩЕ БЫЛ ключ. Он НЕ сводит
--      «Зенит» и «Zenit St Petersburg»: это разные строки и после
--      транслитерации («zenit» против «zenit sankt peterburg»).
--   2. `club_alias` — РЕЗОЛВЕР. Таблица соответствий, которая и сводит их к
--      одному `club_key`. Без неё нормализатор бесполезен, без нормализатора
--      в неё нечего класть.
--
-- ⚠️ ЧТО ПОЧИНИЛОСЬ ЗАОДНО, И ЭТО НЕ КОСМЕТИКА. Старый ключ схлопывал
-- «Бавария II» и «Фрайбург II» в ОДИН club_key = 'ii' — два игрока разных
-- клубов лежали в одном фантомном. Там же 'b' («Порту B»), '08' («Сарпсборг
-- 08») и 'c' («cборная Грузии по футболу»). Всего сдвинулось 5 строк из 1252,
-- и все пять — исправления, а не регресс: остальные 1247 ключей совпадают
-- побуквенно, что проверяется тестом в data_consistency.sql, а не обещанием
-- в этом комментарии.
--
-- ⚠️ СБОРНЫЕ — НЕ КЛУБЫ, и это здесь не придирка. В матчевой статистике
-- «Франция» (397 строк), «Англия» (353), «Германия» (244) стоят там же, где
-- клубы. Записать их в состав значило бы выдать сборную Франции за клуб и
-- приписать Мбаппе два «текущих клуба». Отсюда `football_club.kind` и
-- предикат `is_national_tournament()`: команда, ВСЕ матчи которой в турнирах
-- сборных, — сборная.
--
-- Гранты перечислены явно и `service_role` отдельной строкой: политика без
-- гранта роняла этот проект дважды (см. current_squads.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Турниры сборных.
--
-- Список, а не эвристика по слову «сборная»: турнир называется «Чемпионат
-- мира», и слова «сборная» в нём нет. Отрицание сильнее утверждения —
-- «Товарищеские матчи (клубы)» и «Товарищеские матчи (сборные)» отличаются
-- ровно скобкой, поэтому клубный вариант отсекается ЯВНО и первым.
-- ---------------------------------------------------------------------------
create or replace function public.is_national_tournament(p_tournament text)
returns boolean
language sql immutable
as $$
  select case
    when p_tournament is null then false
    when p_tournament ilike '%(клубы)%' then false
    else p_tournament ilike '%сборны%'
      or p_tournament ilike 'чемпионат мира%'
      or p_tournament ilike 'чемпионат европы%'
      or p_tournament ilike 'квалификация чм%'
      or p_tournament ilike 'квалификация че%'
      or p_tournament ilike 'лига наций%'
      or p_tournament ilike 'кубок африки%'
      or p_tournament ilike 'кубок америки%'
      or p_tournament ilike 'кубок азии%'
      or p_tournament ilike 'золотой кубок%'
      or p_tournament ilike 'олимпиада%'
      or p_tournament ilike '%world cup%'
      or p_tournament ilike '%nations league%'
  end
$$;

comment on function public.is_national_tournament(text) is
  'Турнир сборных. Клубные товарищеские отсекаются ПЕРВЫМИ: они отличаются '
  'от товарищеских матчей сборных одной скобкой.';

-- ---------------------------------------------------------------------------
-- 1. Справочник клубов.
--
-- `club_key` — тот же ключ, которым уже живут `card_current_club.club_key` и
-- сопоставление `fixtures`. Новый справочник НЕ заводит вторую систему
-- ключей: разошлись бы молча.
--
-- `name` хранится как у источника (по-русски, из карточки клуба), `name_en`
-- рядом, а девять языков берутся из `card_translations` по `card_id` — той же
-- цепочкой, что и везде (`shared/lib/cardName.ts`). Своей копии переводов
-- здесь нет намеренно: две копии однажды разойдутся.
-- ---------------------------------------------------------------------------
create table if not exists public.football_club (
  club_key   text primary key,
  name       text not null,
  name_en    text,
  -- Карточка клуба, если она есть. Через неё приходят переводы и эмблема.
  -- Необязательна: команда из матчевой статистики карточки может не иметь.
  card_id    uuid references public.cards(id) on delete set null,
  country    text,
  league     text,
  crest_url  text,
  -- 'club' | 'national'. Сборные держатся здесь же, а не выбрасываются:
  -- матчи у них настоящие, и на экране матча сборную надо чем-то назвать.
  -- Но в составы они не попадают — см. rebuild_club_squads().
  kind       text not null default 'club' check (kind in ('club','national')),
  fetched_at timestamptz not null default now()
);

create index if not exists football_club_kind_idx on public.football_club (kind);
create index if not exists football_club_name_idx on public.football_club (lower(name));

comment on table public.football_club is
  'Справочник футбольных клубов. НЕ путать с teams — та про команды игровой '
  'комнаты Элиаса. Собирается rebuild_football_clubs() из карточек клубов, '
  'fixtures и матчевой статистики.';

-- ---------------------------------------------------------------------------
-- 2. Соответствия названий.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ УМНАЯ ФУНКЦИЯ. Функция может нормализовать
-- написание, но не может знать, что «ПСЖ» — это «Paris Saint-Germain»:
-- общих букв там нет. Это словарь, а словарь — данные.
--
-- `scope` — страна турнира, как её пишет sports.ru («Англия», «Россия»), либо
-- пустая строка для соответствия без оговорок. Он существует потому, что
-- «Арсенал» — это два разных клуба, и различает их только турнир: за
-- последние 400 дней все 1186 матчей «Арсенала» сыграны в английских
-- турнирах, ни одного в российских. Без scope пришлось бы либо угадывать,
-- либо не заводить псевдоним вовсе.
--
-- Пустая строка, а не NULL, — потому что она входит в первичный ключ, а NULL
-- в нём не сравнивается сам с собой и уникальность бы не держалась.
-- ---------------------------------------------------------------------------
create table if not exists public.club_alias (
  alias_key  text not null,
  scope      text not null default '',
  club_key   text not null,
  source     text not null,
  primary key (alias_key, scope)
);

create index if not exists club_alias_club_idx on public.club_alias (club_key);

comment on table public.club_alias is
  'alias_key (нормализованный club_norm_key) → club_key. Заполняется для '
  'обоих алфавитов: без неё «Зенит» и «Zenit St Petersburg» — разные клубы.';

-- ---------------------------------------------------------------------------
-- 3. Резолвер. ЕДИНСТВЕННЫЙ способ превратить название в club_key.
--
-- ЧЕТЫРЕ ШАГА, И ТРЕТИЙ ИЗ НИХ ПОЯВИЛСЯ ПО ЗАМЕРУ, А НЕ ПО ЗАМЫСЛУ.
--
--   1. Псевдоним в пределах страны турнира — им различаются «Арсеналы».
--   2. Псевдоним без оговорок.
--   3. ЛЮБОЙ псевдоним, если во всех странах он ведёт в одно и то же место.
--   4. Голый нормализованный ключ.
--
-- ⚠️ Без третьего шага клуб раскалывался НАДВОЕ, и выглядело это безобидно.
-- Еврокубки страну не называют («Лига чемпионов» — без точки), поэтому у
-- матча ЛЧ scope пустой, шаг 1 промахивается, шага 2 может не быть — и
-- «Тоттенхэм» уезжал в свой ключ `tottenhem`, а в АПЛ лежал под
-- `tottenham hotspur`. Получалось два справочника на один клуб: в одном
-- матчи лиги, в другом еврокубка, и оба на экране выглядели бы правдоподобно.
-- Так же раскалывались ПСЖ, Интер, Байер и Бавария.
--
-- Четвёртый шаг нужен: клуб, которого нет в справочнике, всё равно обязан
-- получать стабильный ключ, иначе его матчи рассыпались бы по написаниям.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_club_key(p_name text, p_scope text default null)
returns text
language sql stable
set search_path = public
as $$
  with k as (select club_norm_key(p_name) as key)
  select coalesce(
    (select a.club_key from club_alias a, k
      where a.alias_key = k.key and a.scope = coalesce(p_scope, '') and p_scope is not null),
    (select a.club_key from club_alias a, k where a.alias_key = k.key and a.scope = ''),
    (select max(a.club_key) from club_alias a, k
      where a.alias_key = k.key
      having count(distinct a.club_key) = 1),
    (select k.key from k)
  )
$$;

comment on function public.resolve_club_key(text, text) is
  'Название команды → club_key. Порядок: псевдоним в пределах страны турнира; '
  'псевдоним без оговорок; ЛЮБОЙ псевдоним, если во всех странах он один и '
  'тот же; голый нормализованный ключ. Третий шаг существует потому, что '
  'еврокубки страну не называют: без него «Тоттенхэм» в Лиге чемпионов уезжал '
  'в отдельный ключ tottenhem, и у клуба получалось ДВА справочника — один с '
  'матчами лиги, другой с матчами ЛЧ, оба правдоподобные на вид.';

-- Страна турнира, как её пишет sports.ru: «Англия. Премьер-лига» → «Англия».
-- Турниры без точки (Лига чемпионов, Чемпионат мира) страны не называют, и
-- это правильный NULL: они не различают «Арсеналы».
create or replace function public.tournament_scope(p_tournament text)
returns text
language sql immutable
as $$
  select case
    when p_tournament is null then null
    when position('.' in p_tournament) = 0 then null
    else nullif(btrim(split_part(p_tournament, '.', 1)), '')
  end
$$;
comment on function public.tournament_scope(text) is
  'Страна турнира, как её пишет sports.ru: «Англия. Премьер-лига» → «Англия». '
  'Турнир без точки страны не называет — NULL, и это правильно: Лига '
  'чемпионов не различает «Арсеналы».';

-- ---------------------------------------------------------------------------
-- 4. Соответствия, поставленные ЧЕЛОВЕКОМ.
--
-- ⚠️ ЭТА ТАБЛИЦА НЕ ЗАПАСНОЙ ВАРИАНТ, А ОБЯЗАТЕЛЬНАЯ ЧАСТЬ. Три класса
-- случаев не выводятся ничем, и все три замерены на боевых данных:
--
--   1. У КАРТОЧКИ НЕВЕРНЫЙ name_en. «Зенит» в ру-вики — астрономический
--      зенит, и резолв по голому имени записал в карточку `Zenith`; «Факел» →
--      `Torch`. Это известная ловушка, она описана в docs/MAP.md §7а. Из-за
--      неё 198 матчей «Зенита» уезжали в клуб `zenith`.
--   2. ОДИН КЛУБ ПОД ОФИЦИАЛЬНЫМ И КОРОТКИМ ИМЕНЕМ. Карточка знает
--      «Bologna F.C. 1909», ESPN пишет «Bologna» — и в справочнике заводились
--      две записи. Так же Como/Como 1907, Lyon/Olympique Lyonnais,
--      Marseille/Olympique de Marseille, Nice/OGC Nice и ещё десяток.
--   3. СВИДЕТЕЛЬСТВО ПРЯМО ОШИБОЧНО. Сведение по игроку связало «Крузейро» с
--      `cruz azul` — это разные клубы в разных странах. Автоматика тут не
--      ошиблась «немного»: она ошиблась целиком, и поймать это можно только
--      глазами.
--
-- Правится INSERT'ом без деплоя — тем же способом, что digest_source.
-- ---------------------------------------------------------------------------
create table if not exists public.club_alias_seed (
  alias_key text not null,
  scope     text not null default '',
  club_key  text not null,
  note      text,
  primary key (alias_key, scope)
);

comment on table public.club_alias_seed is
  'Соответствия, поставленные ЧЕЛОВЕКОМ. Побеждают всё, что выводится '
  'автоматически, и правятся INSERT''ом без деплоя — как digest_source.';

insert into public.club_alias_seed (alias_key, scope, club_key, note) values
  ('zenit',            '', 'zenit st petersburg',       'карточка отдаёт Zenith — астрономический зенит'),
  ('zenith',           '', 'zenit st petersburg',       'тот же промах резолва с другой стороны'),
  ('fakel',            '', 'fakel voronezh',            'карточка отдаёт Torch'),
  ('torch',            '', 'fakel voronezh',            'тот же промах'),
  ('kruzeyro',         '', 'cruzeiro',                  'сведение по игроку дало Cruz Azul — другой клуб, другая страна'),
  ('cruz azul',        '', 'cruz azul',                 'и он сам по себе существует, не сливать'),
  ('bologna',          '', 'bologna 1909',              'один клуб, короткое и официальное имя'),
  ('como',             '', 'como 1907',                 'то же'),
  ('hoffenheim',       '', '1899 hoffenheim',           'то же'),
  ('lyon',             '', 'olympique lyonnais',        'то же'),
  ('marseille',        '', 'olympique de marseille',    'то же'),
  ('genoa',            '', 'genoa cfc',                 'то же'),
  ('palmeiras',        '', 'se palmeiras',              'то же'),
  ('celta vigo',       '', 'celta de vigo',             'то же'),
  ('lille',            '', 'lille osc',                 'то же'),
  ('nice',             '', 'ogc nice',                  'то же'),
  ('alav s',           '', 'deportivo alav s',          'то же'),
  ('angers',           '', 'angers sco',                'то же'),
  ('strasbourg',       '', 'strasbourg alsace',         'то же'),
  ('athletic',         '', 'athletic bilbao',           'то же'),
  ('racing santander', '', 'racing de santander',       'то же'),
  ('hamburg',          '', 'hamburger',                 'то же'),
  ('cologne',          '', '1 k ln',                    'то же'),
  ('river plate',      '', 'atl tico river plate',      'то же'),
  ('gr mio',           '', 'gr mio fbpa',               'то же'),
  ('krylia sovetov',   '', 'pfc krylia sovetov samara', 'то же'),
  ('atl tico mg',      '', 'clube atl tico mineiro',    'то же'),
  ('atl tico madrid',  '', 'atletiko',                  'карточка без name_en — ключ вышел из русского имени'),
  ('gazovik orenburg', '', 'orenburg',                  'бывшее название того же клуба')
on conflict (alias_key, scope) do update set
  club_key = excluded.club_key, note = excluded.note;

-- ---------------------------------------------------------------------------
-- 5. Названия команд, встреченные в статистике, и то, во что они разрешились.
--
-- ⚠️ ЭТО НЕ УДОБСТВО, А ЦЕНА ПРОГОНА. Наивная сборка звала resolve_club_key()
-- на КАЖДУЮ строку статистики: 60 730 сторон при 1934 различных названиях, то
-- есть в тридцать раз больше работы, и каждый вызов — подзапросы к club_alias.
-- Прогон не укладывался в минуту и откатывался целиком.
--
-- Вторая причина держать это таблицей, а не считать на лету: «почему матч
-- уехал не туда» можно посмотреть глазами. Без неё пришлось бы выводить
-- ответ заново тем же кодом, который и ошибся.
-- ---------------------------------------------------------------------------
create table if not exists public.club_name_seen (
  team          text not null,
  scope         text not null default '',
  seen          integer not null,
  national_only boolean not null,
  first_seen    date,
  last_seen     date,
  club_key      text,
  primary key (team, scope)
);

create index if not exists club_name_seen_key_idx on public.club_name_seen (club_key);

comment on table public.club_name_seen is
  'Каждое название команды, встреченное в статистике, и то, во что оно '
  'разрешилось. Существует по двум причинам: резолвить 1934 названия, а не '
  '60 730 строк, и чтобы «почему матч уехал не туда» можно было посмотреть '
  'глазами, а не выводить заново.';

-- ---------------------------------------------------------------------------
-- 6. Сборка словаря.
--
-- ЧЕТЫРЕ ИСТОЧНИКА, И У КАЖДОГО СВОЙ ВЕС. Порядок вставки обратный весу —
-- `on conflict do nothing` оставляет первое, то есть более достоверное.
--
--   S. SEED — то, что сказал человек. Главнее всего.
--   A1. КАРТОЧКА КЛУБА — 430 штук, у 404 есть и русское имя, и английское.
--       Единственный СВЕРЕННЫЙ ЧЕЛОВЕКОМ словарь в базе, поэтому он задаёт
--       канонический club_key. Голое имя без скобок («Арсенал (Лондон)» →
--       «Арсенал») заводится ТОЛЬКО если такое голое имя даёт ровно одна
--       карточка: «Арсенал» дают две — Лондон и Тула, — и глобального
--       псевдонима у него не будет.
--   A2. ОДИН МАТЧ ДВУМЯ ИСТОЧНИКАМИ — sports.ru и ESPN прислали один и тот же
--       матч одного игрока в один день, один по-русски, другой по-английски.
--       ПРЯМОЕ соответствие, а не статистика. Замер: 695 таких строк.
--   A3. СОВПАДЕНИЕ ПО ИГРОКУ — у карточки есть латинский клуб из википедии и
--       кириллическая команда, стоящая в большинстве её матчей. Слабейший
--       источник, поэтому требует ДВУХ согласных игроков: один мог перейти.
-- ---------------------------------------------------------------------------
create or replace function public.build_club_aliases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Пересобирается с нуля: строка, которую человек убрал из seed, обязана
  -- исчезнуть и отсюда, иначе правка seed ничего не меняет.
  delete from club_alias;

  insert into club_alias (alias_key, scope, club_key, source)
  select alias_key, scope, club_key, 'seed' from club_alias_seed
  on conflict (alias_key, scope) do nothing;

  insert into club_alias (alias_key, scope, club_key, source)
  select k, '', ck, 'card'
    from (
      select club_norm_key(c.name) as k, club_norm_key(coalesce(c.name_en, c.name)) as ck
        from cards c where c.category='club' and c.active and c.name is not null
      union
      select club_norm_key(c.name_en), club_norm_key(c.name_en)
        from cards c where c.category='club' and c.active and c.name_en is not null
    ) s
   where k is not null and ck is not null
  on conflict (alias_key, scope) do nothing;

  insert into club_alias (alias_key, scope, club_key, source)
  select bare, '', min(ck), 'card_bare'
    from (
      select club_norm_key(btrim(regexp_replace(c.name, '\s*\(.*\)\s*$', ''))) as bare,
             club_norm_key(coalesce(c.name_en, c.name))                       as ck
        from cards c
       where c.category='club' and c.active and c.name ~ '\('
    ) s
   where bare is not null and ck is not null
   group by bare
  having count(distinct ck) = 1
  on conflict (alias_key, scope) do nothing;

  insert into club_alias (alias_key, scope, club_key, source)
  select k, scope, ck, 'same_match'
    from (
      select club_norm_key(t.ru) as k,
             coalesce(tournament_scope(t.tournament), '') as scope,
             club_norm_key(t.en) as ck,
             count(*) as seen
        from (
          select r.tournament, r.home_team as ru, e.home_team as en
            from player_match_stats r
            join player_match_stats e
              on e.card_id = r.card_id and e.match_date = r.match_date and e.source = 'espn'
           where r.source = 'sports.ru' and not r.disputed and not e.disputed
          union all
          select r.tournament, r.away_team, e.away_team
            from player_match_stats r
            join player_match_stats e
              on e.card_id = r.card_id and e.match_date = r.match_date and e.source = 'espn'
           where r.source = 'sports.ru' and not r.disputed and not e.disputed
        ) t
       where t.ru ~ '[А-Яа-яЁё]' and t.en !~ '[А-Яа-яЁё]'
       group by 1, 2, 3
    ) s
   where k is not null and ck is not null and k <> ck and seen >= 2
  on conflict (alias_key, scope) do nothing;

  insert into club_alias (alias_key, scope, club_key, source)
  select k, scope, ck, 'player_overlap'
    from (
      select club_norm_key(m.team) as k,
             coalesce(m.scope, '') as scope,
             cc.club_key           as ck,
             count(distinct m.card_id) as agree
        from (
          select distinct on (x.card_id) x.card_id, x.team, x.scope
            from (
              select d.card_id, t.team, tournament_scope(d.tournament) as scope,
                     count(*) as n
                from player_match_days d
                cross join lateral (values (d.home_team), (d.away_team)) as t(team)
               where d.match_date >= current_date - 400
               group by d.card_id, t.team, tournament_scope(d.tournament)
            ) x
           order by x.card_id, x.n desc, x.team
        ) m
        join card_current_club cc on cc.card_id = m.card_id
       where m.team ~ '[А-Яа-яЁё]' and cc.club_key is not null
       group by 1, 2, 3
    ) s
   where k is not null and ck is not null and k <> ck and agree >= 2
  on conflict (alias_key, scope) do nothing;

  -- ⚠️ ДВА ШАГА, КОТОРЫЕ И ДЕЛАЮТ РУЧНОЕ СООТВЕТСТВИЕ ГЛАВНЫМ.
  --
  -- Без них seed ПРОИГРЫВАЛ, и это было измерено: резолвер сначала смотрит
  -- псевдоним В ПРЕДЕЛАХ СТРАНЫ, а seed стоял без страны. «Болонья» в Италии
  -- уезжала в bologna, а вне Италии — в bologna 1909, и у клуба выходило два
  -- справочника. Ровно то же у Лиона, Марселя, Атлетика и Крузейро.
  --
  -- 1. Человек сказал «это название значит вот этот клуб» — значит во ВСЕХ
  --    странах. Выведенные строки с тем же ключом убираются.
  delete from club_alias a
   where a.source <> 'seed'
     and exists (select 1 from club_alias_seed s
                  where s.alias_key = a.alias_key and s.scope = ''
                    and s.club_key <> a.club_key);

  -- 2. И то же самое значит СЛИЯНИЕ КЛЮЧЕЙ: если seed говорит «athletic — это
  --    athletic bilbao», то любой псевдоним, ведущий на athletic, ведёт на
  --    athletic bilbao. Без этого пришлось бы вписывать в seed оба алфавита
  --    каждого клуба руками, и «Атлетик» всё равно остался бы расколотым: его
  --    русский ключ atletik в seed не назван.
  update club_alias a
     set club_key = s.club_key
    from club_alias_seed s
   where s.scope = '' and a.club_key = s.alias_key and a.club_key <> s.club_key;

  select count(*) into v_count from club_alias;
  return v_count;
end;
$$;

comment on function public.build_club_aliases() is
  'Пересобирает club_alias: seed человека, потом карточки, потом два вида '
  'свидетельств. Заканчивается тем, что seed распространяется на все страны '
  'и на оба алфавита — см. комментарии внутри.';

-- ---------------------------------------------------------------------------
-- 7. Сборка справочника.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_football_clubs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  create temporary table _days on commit drop as
    select card_id, match_date, tournament, home_team, away_team,
           tournament_scope(tournament) as scope,
           is_national_tournament(tournament) as is_nat
      from player_match_days;

  delete from club_name_seen;
  insert into club_name_seen (team, scope, seen, national_only, first_seen, last_seen)
  select t.team, coalesce(t.scope, ''), count(*)::int, bool_and(t.is_nat),
         min(t.match_date), max(t.match_date)
    from (
      select home_team as team, scope, is_nat, match_date from _days
      union all
      select away_team, scope, is_nat, match_date from _days
    ) t
   where t.team is not null and btrim(t.team) <> ''
   group by 1, 2;

  insert into football_club (club_key, name, name_en, card_id, country, crest_url, kind, fetched_at)
  select distinct on (club_norm_key(coalesce(c.name_en, c.name)))
         club_norm_key(coalesce(c.name_en, c.name)),
         c.name, c.name_en, c.id, c.country, c.photo_url, 'club', now()
    from cards c
   where c.category = 'club' and c.active
     and club_norm_key(coalesce(c.name_en, c.name)) is not null
   -- При двух карточках на один ключ выигрывает известнейшая: у неё больше
   -- шансов оказаться тем клубом, про который спрашивают.
   order by club_norm_key(coalesce(c.name_en, c.name)), c.fame desc nulls last, c.name
  on conflict (club_key) do update set
    name       = excluded.name,
    name_en    = excluded.name_en,
    card_id    = excluded.card_id,
    country    = coalesce(excluded.country, football_club.country),
    crest_url  = coalesce(excluded.crest_url, football_club.crest_url),
    fetched_at = now();

  perform build_club_aliases();

  update club_name_seen s
     set club_key = resolve_club_key(s.team, nullif(s.scope, ''));

  -- Клуб без карточки — обычная вещь: карточек 430, а команд в матчах 1563.
  -- Имя берётся то, которым его чаще всего называет источник.
  insert into football_club (club_key, name, kind, fetched_at)
  select q.club_key, q.name, case when q.national_only then 'national' else 'club' end, now()
    from (
      select s.club_key,
             (array_agg(s.team order by s.seen desc))[1] as name,
             bool_and(s.national_only) as national_only
        from club_name_seen s
       where s.club_key is not null
       group by s.club_key
    ) q
  on conflict (club_key) do nothing;

  -- То же для команд из расписания: они на латинице, приходят от the-odds-api
  -- и могут не встречаться в матчевой статистике вовсе.
  insert into football_club (club_key, name, kind, fetched_at)
  select ck, name, 'club', now()
    from (
      select resolve_club_key(t.team, null) as ck,
             (array_agg(t.team))[1] as name
        from (select home_team as team from fixtures
              union select away_team from fixtures) t
       where t.team is not null
       group by 1
    ) q
   where ck is not null
  on conflict (club_key) do nothing;

  -- Сборные: команда, у которой ВСЕ матчи в турнирах сборных. Пересчитывается
  -- каждый раз, а не ставится при вставке: клуб, у которого пока один матч в
  -- Лиге наций, не должен остаться сборной навсегда.
  update football_club f set kind = q.kind
    from (
      select s.club_key,
             case when bool_and(s.national_only) then 'national' else 'club' end as kind
        from club_name_seen s
       where s.club_key is not null
       group by s.club_key
    ) q
   where f.club_key = q.club_key and f.kind is distinct from q.kind
     -- Карточка клуба перевешивает: если человек завёл её как клуб, значит
     -- клуб, сколько бы матчей за сборную ни лежало под этим именем.
     and f.card_id is null;

  -- Домашняя лига — самый частый турнир вида «Страна. Лига», не кубок. Кубок
  -- отсекается потому, что называет ту же страну, но лигой не является.
  update football_club f
     set country = coalesce(f.country, q.country),
         league  = q.league
    from (
      select distinct on (x.club_key) x.club_key, x.country, x.league
        from (
          select s.club_key, s.scope as country, d.tournament as league, count(*) as n
            from _days d
            join lateral (values (d.home_team), (d.away_team)) as t(team) on true
            join club_name_seen s on s.team = t.team and s.scope = coalesce(d.scope, '')
           where d.match_date >= current_date - 400
             and d.scope is not null
             and not d.is_nat
             and d.tournament !~* 'кубок'
             and s.club_key is not null
           group by 1, 2, 3
        ) x
       order by x.club_key, x.n desc, x.league
    ) q
   where f.club_key = q.club_key;

  select count(*) into v_count from football_club;
  return v_count;
end;
$$;

comment on function public.rebuild_football_clubs() is
  'Пересобирает football_club и club_name_seen, словарь строит '
  'build_club_aliases(). Названия резолвятся ОДИН раз на название, а не на '
  'строку статистики: наивная версия делала 60 730 вызовов вместо 1934 и не '
  'укладывалась в минуту. Уборку осиротевших делает prune_orphan_clubs() '
  'отдельно — ей нужны уже собранные составы.';

-- ---------------------------------------------------------------------------
-- prune_orphan_clubs — убрать записи, на которые больше ничего не показывает.
--
-- Они остаются после слияния ключей: «bologna» после того, как стал «bologna
-- 1909», «tottenhem» после объединения с «tottenham hotspur». Пустая строка в
-- списке команд — это строка, ведущая на пустой экран, и её надо убирать, а
-- не сортировать вниз.
-- ---------------------------------------------------------------------------
create or replace function public.prune_orphan_clubs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- ⚠️ КЛЮЧИ РАСПИСАНИЯ СЧИТАЮТСЯ ОДИН РАЗ. Наивная версия звала
  -- resolve_club_key() внутри NOT EXISTS, то есть на каждую пару
  -- «клуб × фикстура»: 1743 × 589 × 2 ≈ 2 млн вызовов, и прогон не
  -- укладывался в минуту. Здесь их 1178.
  create temporary table _fixture_keys on commit drop as
    select distinct resolve_club_key(t.team, null) as club_key
      from (select home_team as team from fixtures
            union select away_team from fixtures) t
     where t.team is not null;
  create index on _fixture_keys (club_key);

  delete from football_club f
   where f.card_id is null
     and not exists (select 1 from club_name_seen s where s.club_key = f.club_key)
     and not exists (select 1 from club_squad q where q.club_key = f.club_key)
     and not exists (select 1 from _fixture_keys x where x.club_key = f.club_key);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.prune_orphan_clubs() is
  'Убирает записи справочника, на которые больше ничего не показывает.';

-- ---------------------------------------------------------------------------
-- 8. Составы — С ИСТОРИЕЙ, а не «текущий клуб одной строкой».
--
-- ЗАЧЕМ ИСТОРИЯ. Без неё переход неотличим от ошибки: игрок просто исчезает
-- из одного состава и появляется в другом, и сказать, случился ли трансфер
-- или сломался разбор, нельзя ни постфактум, ни в момент.
--
-- ⚠️ ЧЕСТНОЕ ЗНАЧЕНИЕ joined_at. Это НЕ дата трансфера — её нам никто не
-- продаёт. Это дата ПЕРВОГО СВИДЕТЕЛЬСТВА: самый ранний матч, в котором игрок
-- вышел за этот клуб. Соответственно left_at — дата последнего свидетельства,
-- а не дата ухода. Назвать их «пришёл» и «ушёл» и показать как факт значило бы
-- соврать; показывать надо как «с ... по ...».
--
-- ⚠️ СБОРНЫЕ В СОСТАВЫ НЕ ПОПАДАЮТ. У Мбаппе иначе оказалось бы два текущих
-- клуба — «ПСЖ» и «Франция», — и оба выглядели бы одинаково правдоподобно.
-- ---------------------------------------------------------------------------
create table if not exists public.club_squad (
  club_key     text not null,
  card_id      uuid not null references public.cards(id) on delete cascade,
  shirt_number smallint,
  position     text,
  joined_at    date,
  left_at      date,
  -- 'wiki_career' | 'matches' | 'sports_ru' | 'wikidata' — чем подтверждён.
  source       text not null,
  fetched_at   timestamptz not null default now(),
  primary key (club_key, card_id)
);

create index if not exists club_squad_card_idx on public.club_squad (card_id);
create index if not exists club_squad_current_idx
  on public.club_squad (club_key) where left_at is null;

-- Игрок может числиться в ОДНОМ текущем составе. Аренды и вторые команды
-- существуют, но показать человека сразу в двух составах — значит показать
-- ошибку разбора и трансфер одинаково.
create unique index if not exists club_squad_one_current_idx
  on public.club_squad (card_id) where left_at is null;

comment on table public.club_squad is
  'Состав клуба с историей. joined_at/left_at — даты ПЕРВОГО и ПОСЛЕДНЕГО '
  'свидетельства, а не трансфера: дат трансферов у нас нет.';

-- ---------------------------------------------------------------------------
-- rebuild_club_squads — пересобрать составы из свидетельств.
--
-- Порядок доверия: список Викиданных (P54 без даты окончания) → открытый
-- диапазон лет в википедии → команда, стоящая в большинстве матчей игрока →
-- страница клуба на sports.ru.
--
-- ⚠️ Строки источника `wikidata` ЭТА ФУНКЦИЯ НЕ ТРОГАЕТ. Их пишет
-- docs/clubs_squads_wikidata.py, и они переживают пересборку: вывести их
-- заново отсюда нечем — в базе их источника нет.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_club_squads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Матчи игроков, у которых команда УЖЕ разрешена в ключ. Join к
  -- club_name_seen вместо вызова resolve_club_key() на строку: названий 1934,
  -- строк 60 730.
  create temporary table _pm on commit drop as
    select d.card_id, d.match_date, d.tournament,
           is_national_tournament(d.tournament) as is_nat,
           sh.club_key as home_key, sa.club_key as away_key
      from player_match_days d
      left join club_name_seen sh
        on sh.team = d.home_team and sh.scope = coalesce(tournament_scope(d.tournament), '')
      left join club_name_seen sa
        on sa.team = d.away_team and sa.scope = coalesce(tournament_scope(d.tournament), '');
  create index on _pm (card_id);

  create temporary table _squad_evidence on commit drop as
  with wiki as (
    select cc.card_id, cc.club_key, 1 as trust, 'wiki_career' as source
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     where cc.club_key is not null
  ),
  from_matches as (
    -- Команда, стоящая в большинстве матчей игрока за последний год, и
    -- стоящая там НЕ ЕДИНОЖДЫ: один матч может быть и заменой в кубке за
    -- вторую команду.
    select distinct on (x.card_id) x.card_id, x.club_key, 2, 'matches'
      from (
        select p.card_id, t.club_key, count(*) as n
          from _pm p
          cross join lateral (values (p.home_key), (p.away_key)) as t(club_key)
          join cards c on c.id = p.card_id and c.active and c.category = 'player'
         where p.match_date >= current_date - 400
           and not p.is_nat
           and t.club_key is not null
         group by p.card_id, t.club_key
        having count(*) >= 2
      ) x
     order by x.card_id, x.n desc, x.club_key
  ),
  from_sports_ru as (
    select s.card_id, resolve_club_key(s.club_slug, null), 3, 'sports_ru'
      from sports_ru_player s
      join cards c on c.id = s.card_id and c.active and c.category = 'player'
     where s.club_slug is not null
  )
  select * from wiki
  union all select * from from_matches
  union all select * from from_sports_ru;

  -- Одна строка на игрока: побеждает достовернейшее свидетельство. Сборные
  -- отбрасываются здесь, а не при сборе, — иначе игрок, у которого свидетель
  -- только сборная, остался бы вовсе без состава вместо следующего по доверию.
  create temporary table _squad_now on commit drop as
  select distinct on (e.card_id) e.card_id, e.club_key, e.source
    from _squad_evidence e
    join football_club f on f.club_key = e.club_key and f.kind = 'club'
   where e.club_key is not null
   order by e.card_id, e.trust;
  create index on _squad_now (card_id);

  create temporary table _squad_dates on commit drop as
  select n.card_id, n.club_key, min(p.match_date) as first_match
    from _squad_now n
    join _pm p on p.card_id = n.card_id
   where p.home_key = n.club_key or p.away_key = n.club_key
   group by n.card_id, n.club_key;

  -- Ушедшие: числились в составе, свидетельства больше нет. Дата ухода —
  -- последнее свидетельство, а не сегодня: «перестал появляться» случилось
  -- тогда, а не в момент, когда мы это заметили.
  update club_squad q
     set left_at = coalesce(
           (select max(d.match_date) from player_match_days d where d.card_id = q.card_id),
           current_date)
   where q.left_at is null
     and q.source <> 'wikidata'
     and not exists (
       select 1 from _squad_now n
        where n.card_id = q.card_id and n.club_key = q.club_key);

  insert into club_squad (club_key, card_id, joined_at, left_at, source, fetched_at)
  select n.club_key, n.card_id, d.first_match, null, n.source, now()
    from _squad_now n
    left join _squad_dates d on d.card_id = n.card_id and d.club_key = n.club_key
    -- Викиданные точнее выведенного: если игрок уже приписан ими к клубу,
    -- вывод по матчам его не перекладывает.
   where not exists (select 1 from club_squad w
                      where w.card_id = n.card_id and w.left_at is null
                        and w.source = 'wikidata')
  on conflict (club_key, card_id) do update set
    left_at    = null,
    joined_at  = coalesce(club_squad.joined_at, excluded.joined_at),
    source     = excluded.source,
    fetched_at = now();

  select count(*) into v_count from club_squad where left_at is null;
  return v_count;
end;
$$;

comment on function public.rebuild_club_squads() is
  'Пересобирает club_squad из card_current_club, матчей и sports_ru_player. '
  'Строки источника wikidata не трогает — их вывести заново нечем.';

-- ---------------------------------------------------------------------------
-- 9. Матчи КОМАНД — то, на чём держится экран команды.
--
-- ⚠️ ГЛАВНАЯ НАХОДКА ВСЕЙ РАБОТЫ, и она меняет ответ на вопрос «есть ли что
-- показывать». Составы у нас редкие: 11 игроков набирается у 43 клубов. А
-- матчи — нет: те же 30 880 строк статистики игроков, свёрнутые до матча,
-- дают 7136 матчей с 2008 года, и у 516 команд их пять и больше за год.
-- Экран, построенный только на составах, показывал бы пустоту там, где
-- данные есть.
--
-- ПОЧЕМУ ТАБЛИЦА, А НЕ ПРЕДСТАВЛЕНИЕ. Свёртка 31 тыс. строк с резолвом двух
-- названий на каждую — работа, которую пришлось бы делать на каждый заход на
-- экран. А обновлять чаще, чем обновляется источник, бессмысленно: sports.ru
-- собирается раз в сутки в 04:40 UTC.
-- ---------------------------------------------------------------------------
create table if not exists public.club_match (
  match_date date not null,
  home_key   text not null,
  away_key   text not null,
  tournament text,
  -- Как их написал источник: ключ для сведения, имя для показа.
  home_team  text not null,
  away_team  text not null,
  home_score smallint,
  away_score smallint,
  fetched_at timestamptz not null default now(),
  primary key (match_date, home_key, away_key)
);

create index if not exists club_match_home_idx on public.club_match (home_key, match_date desc);
create index if not exists club_match_away_idx on public.club_match (away_key, match_date desc);

comment on table public.club_match is
  'Матчи команд, свёрнутые из player_match_stats. 7136 матчей против 589 в '
  'fixtures — расписание начинается 10.08.2026, а статистика с 2008 года.';

create or replace function public.rebuild_club_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into club_match (match_date, home_key, away_key, tournament,
                          home_team, away_team, home_score, away_score, fetched_at)
  select distinct on (m.match_date, m.home_key, m.away_key)
         m.match_date, m.home_key, m.away_key, m.tournament,
         m.home_team, m.away_team, m.home_score, m.away_score, now()
    from (
      select d.match_date, d.tournament, d.home_team, d.away_team,
             d.home_score, d.away_score,
             sh.club_key as home_key, sa.club_key as away_key
        from player_match_days d
        join club_name_seen sh
          on sh.team = d.home_team and sh.scope = coalesce(tournament_scope(d.tournament), '')
        join club_name_seen sa
          on sa.team = d.away_team and sa.scope = coalesce(tournament_scope(d.tournament), '')
       where d.home_score is not null and d.away_score is not null
    ) m
   where m.home_key is not null and m.away_key is not null
     -- Ключи сошлись — значит псевдоним неверен и матч был бы «сам с собой».
     -- Молча пропустить его правильнее, чем нарисовать: такая строка сломала
     -- бы и разницу мячей, и форму.
     and m.home_key <> m.away_key
   order by m.match_date, m.home_key, m.away_key, m.home_score desc nulls last
  on conflict (match_date, home_key, away_key) do update set
    tournament = excluded.tournament,
    home_team  = excluded.home_team,
    away_team  = excluded.away_team,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    fetched_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.rebuild_club_matches() is
  'Свёртка player_match_days до матчей команд. Матч «сам с собой» (ключи '
  'сошлись из-за неверного псевдонима) пропускается.';

-- ===========================================================================
-- 10. ЧТЕНИЕ. Всё, что видит экран команды.
--
-- Все функции ниже — SECURITY DEFINER, потому что читают player_match_days, а
-- он игрокам намеренно не отдан (stats_dedupe_and_namesakes.sql): статистика
-- наружу идёт только через функции, а не прямым запросом к представлению.
--
-- ⚠️ ОЧКИ СЧИТАЕТ SQL И ТОЛЬКО SQL, по той же шкале `голы*4 + пасы*3`, что и
-- player_ratings с фэнтези. Второе место, считающее то же самое, однажды
-- разойдётся с первым — и обе цифры будут выглядеть правдоподобно.
-- ===========================================================================

-- Локализованное имя клуба. Цепочка та же, что в shared/lib/cardName.ts:
-- ru → name, прочие → перевод → name_en → name. Своей копии переводов у
-- справочника нет намеренно: две копии однажды разойдутся.
create or replace function public.club_display_name(p_club_key text, p_lang text)
returns text
language sql stable
set search_path = public
as $$
  select case
    when left(coalesce(p_lang,'ru'), 2) = 'ru' then f.name
    else coalesce(
      (select t.name from card_translations t
        where t.card_id = f.card_id and t.lang = left(coalesce(p_lang,'ru'), 2)),
      f.name_en, f.name)
  end
  from football_club f where f.club_key = p_club_key
$$;

-- ---------------------------------------------------------------------------
-- club_profile — шапка экрана: кто это и как идут дела.
--
-- ⚠️ ОКНО В ДНЯХ, А НЕ «СЕЗОН». Сезон у каждой лиги свой, а у нас нет ни
-- календаря сезонов, ни их границ. Окно честно называется числом дней, и
-- экран обязан это написать: «за 365 дней», а не «в сезоне».
-- ---------------------------------------------------------------------------
create or replace function public.club_profile(p_club_key text, p_lang text default 'ru',
                                               p_days integer default 365)
returns table (
  club_key text, name text, name_en text, card_id uuid,
  country text, league text, crest_url text, kind text,
  squad integer, matches integer, wins integer, draws integer, losses integer,
  goals_for integer, goals_against integer,
  first_match date, last_match date, fetched_at timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  with f as (select * from football_club where club_key = p_club_key),
  played as (
    select m.match_date,
           case when m.home_key = p_club_key then m.home_score else m.away_score end as gf,
           case when m.home_key = p_club_key then m.away_score else m.home_score end as ga
      from club_match m
     where (m.home_key = p_club_key or m.away_key = p_club_key)
       and m.match_date >= current_date - greatest(coalesce(p_days, 365), 1)
       and m.home_score is not null and m.away_score is not null
  )
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.name_en, f.card_id, f.country, f.league, f.crest_url, f.kind,
         (select count(*)::int from club_squad q where q.club_key = f.club_key and q.left_at is null),
         (select count(*)::int from played),
         (select count(*)::int from played where gf > ga),
         (select count(*)::int from played where gf = ga),
         (select count(*)::int from played where gf < ga),
         (select coalesce(sum(gf),0)::int from played),
         (select coalesce(sum(ga),0)::int from played),
         (select min(match_date) from played),
         (select max(match_date) from played),
         f.fetched_at
    from f
$$;

-- ---------------------------------------------------------------------------
-- club_squad_list — СОСТАВ ЦЕЛИКОМ, со статистикой по каждому.
--
-- ⚠️ БЕЗ ОГРАНИЧЕНИЯ ПО ЧИСЛУ СТРОК, и это решение, а не упущение. В заявке
-- клуба под сорок человек, и состав, обрезанный до одиннадцати, отвечает на
-- вопрос «кто основной», которого никто не задавал, вместо заданного «кто в
-- команде». Порядок — по отдаче в окне, потом по матчам: кто играет, тот и
-- наверху, а остальные всё равно видны.
-- ---------------------------------------------------------------------------
create or replace function public.club_squad_list(p_club_key text, p_lang text default 'ru',
                                                  p_days integer default 365)
returns table (
  card_id uuid, name text, name_en text, photo_url text, country text,
  -- ⚠️ НЕ `position`: в списке колонок RETURNS TABLE это зарезервированное
  -- слово (POSITION(x IN y)), и функция не создаётся вовсе.
  player_position text, shirt_number smallint, joined_at date, source text,
  matches integer, minutes integer, goals integer, assists integer,
  yellow integer, red integer, points integer
)
language sql stable
security definer
set search_path = public
as $$
  select c.id,
         case when left(coalesce(p_lang,'ru'),2) = 'ru' then c.name
              else coalesce((select t.name from card_translations t
                              where t.card_id = c.id and t.lang = left(coalesce(p_lang,'ru'),2)),
                            c.name_en, c.name) end,
         c.name_en, c.photo_url, c.country,
         coalesce(q.position, c.position_ru),
         q.shirt_number, q.joined_at, q.source,
         coalesce(s.matches, 0), s.minutes,
         coalesce(s.goals, 0), coalesce(s.assists, 0),
         coalesce(s.yellow, 0), coalesce(s.red, 0),
         coalesce(s.goals, 0) * 4 + coalesce(s.assists, 0) * 3
    from club_squad q
    join cards c on c.id = q.card_id and c.active
    left join lateral (
      select count(*)::int                        as matches,
             -- NULL, а не ноль: минут нет у ESPN вовсе, и выдуманный ноль
             -- выиграл бы ничью «меньше минут при той же отдаче» у того, кто
             -- её заслужил.
             nullif(sum(coalesce(d.minutes, 0)), 0)::int as minutes,
             sum(coalesce(d.goals, 0))::int       as goals,
             sum(coalesce(d.assists, 0))::int     as assists,
             sum(coalesce(d.yellow, 0))::int      as yellow,
             sum(coalesce(d.red, 0))::int         as red
        from player_match_days d
       where d.card_id = q.card_id
         and d.match_date >= current_date - greatest(coalesce(p_days, 365), 1)
    ) s on true
   where q.club_key = p_club_key and q.left_at is null
   order by (coalesce(s.goals,0) * 4 + coalesce(s.assists,0) * 3) desc,
            coalesce(s.matches, 0) desc, c.name
$$;

-- ---------------------------------------------------------------------------
-- club_recent_matches — сыгранное. Форма читается отсюда же, а не считается
-- вторым способом: пять последних строк этого списка И ЕСТЬ форма.
-- ---------------------------------------------------------------------------
create or replace function public.club_recent_matches(p_club_key text, p_lang text default 'ru',
                                                      p_limit integer default 20)
returns table (
  match_date date, tournament text, home boolean,
  opponent_key text, opponent text,
  goals_for smallint, goals_against smallint, outcome text
)
language sql stable
security definer
set search_path = public
as $$
  select m.match_date, m.tournament,
         (m.home_key = p_club_key),
         case when m.home_key = p_club_key then m.away_key else m.home_key end,
         coalesce(
           club_display_name(case when m.home_key = p_club_key then m.away_key else m.home_key end, p_lang),
           case when m.home_key = p_club_key then m.away_team else m.home_team end),
         case when m.home_key = p_club_key then m.home_score else m.away_score end,
         case when m.home_key = p_club_key then m.away_score else m.home_score end,
         case
           when m.home_score is null or m.away_score is null then null
           when (case when m.home_key = p_club_key then m.home_score else m.away_score end)
              > (case when m.home_key = p_club_key then m.away_score else m.home_score end) then 'w'
           when (case when m.home_key = p_club_key then m.home_score else m.away_score end)
              = (case when m.home_key = p_club_key then m.away_score else m.home_score end) then 'd'
           else 'l'
         end
    from club_match m
   where m.home_key = p_club_key or m.away_key = p_club_key
   order by m.match_date desc
   limit greatest(coalesce(p_limit, 20), 1)
$$;

-- ---------------------------------------------------------------------------
-- club_upcoming_fixtures — расписание. ДРУГОЙ ИСТОЧНИК, чем матчи выше:
-- fixtures приходит от the-odds-api и знает будущее, club_match собран из
-- статистики и знает прошлое. Смешивать их в одном списке нельзя — у них
-- разная свежесть и разный горизонт.
-- ---------------------------------------------------------------------------
create or replace function public.club_upcoming_fixtures(p_club_key text, p_lang text default 'ru',
                                                         p_limit integer default 10)
returns table (
  fixture_id text, commence_at timestamptz, sport_key text,
  home boolean, opponent_key text, opponent text
)
language sql stable
security definer
set search_path = public
as $$
  with f as (
    select x.id, x.commence_at, x.sport_key,
           resolve_club_key(x.home_team, null) as hk,
           resolve_club_key(x.away_team, null) as ak,
           x.home_team, x.away_team
      from fixtures x
     where x.commence_at > now()
  )
  select f.id, f.commence_at, f.sport_key,
         (f.hk = p_club_key),
         case when f.hk = p_club_key then f.ak else f.hk end,
         coalesce(
           club_display_name(case when f.hk = p_club_key then f.ak else f.hk end, p_lang),
           case when f.hk = p_club_key then f.away_team else f.home_team end)
    from f
   where f.hk = p_club_key or f.ak = p_club_key
   order by f.commence_at
   limit greatest(coalesce(p_limit, 10), 1)
$$;

-- ---------------------------------------------------------------------------
-- club_directory — список команд с поиском.
--
-- ⚠️ ПОРЯДОК — ПО ТОМУ, ЧТО МОЖНО ПОКАЗАТЬ, а не по алфавиту. Клуб, у
-- которого ни состава, ни матчей, — строка, ведущая на пустой экран; такие
-- уходят вниз сами собой, без отдельного фильтра, который пришлось бы
-- объяснять.
-- ---------------------------------------------------------------------------
create or replace function public.club_directory(p_lang text default 'ru',
                                                 p_query text default null,
                                                 p_limit integer default 60)
returns table (
  club_key text, name text, country text, league text, crest_url text,
  squad integer, matches integer
)
language sql stable
security definer
set search_path = public
as $$
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.country, f.league, f.crest_url,
         coalesce(q.n, 0)::int, coalesce(m.n, 0)::int
    from football_club f
    left join lateral (select count(*) n from club_squad s
                        where s.club_key = f.club_key and s.left_at is null) q on true
    left join lateral (select count(*) n from club_match c
                        where (c.home_key = f.club_key or c.away_key = f.club_key)
                          and c.match_date >= current_date - 400) m on true
   where f.kind = 'club'
     and (p_query is null or btrim(p_query) = ''
       or f.name ilike '%' || btrim(p_query) || '%'
       or f.name_en ilike '%' || btrim(p_query) || '%'
       or f.club_key like club_norm_key(btrim(p_query)) || '%')
   order by coalesce(q.n, 0) desc, coalesce(m.n, 0) desc, f.name
   limit greatest(coalesce(p_limit, 60), 1)
$$;

-- ---------------------------------------------------------------------------
-- club_of_card — «за кого он играет», для досье игрока и строк рейтинга.
-- Одна функция, чтобы ссылка на команду везде вела в одно место.
-- ---------------------------------------------------------------------------
create or replace function public.club_of_card(p_card_id uuid, p_lang text default 'ru')
returns table (club_key text, name text, crest_url text)
language sql stable
security definer
set search_path = public
as $$
  select f.club_key, club_display_name(f.club_key, p_lang), f.crest_url
    from club_squad q
    join football_club f on f.club_key = q.club_key
   where q.card_id = p_card_id and q.left_at is null
   limit 1
$$;

-- ===========================================================================
-- 11. ПРАВА. Перечислены явно, service_role — отдельными строками.
--
-- Политика без гранта роняла этот проект дважды: Postgres проверяет ГРАНТ
-- раньше политики, и без него вызывающий получает 42501 ещё до того, как
-- политику вообще прочитают (длинный разбор — в current_squads.sql).
-- ===========================================================================
alter table public.football_club   enable row level security;
alter table public.club_alias      enable row level security;
alter table public.club_alias_seed enable row level security;
alter table public.club_name_seen  enable row level security;
alter table public.club_squad      enable row level security;
alter table public.club_match      enable row level security;

drop policy if exists football_club_read on public.football_club;
create policy football_club_read on public.football_club
  for select to anon, authenticated using (true);
drop policy if exists club_squad_read on public.club_squad;
create policy club_squad_read on public.club_squad
  for select to anon, authenticated using (true);
drop policy if exists club_match_read on public.club_match;
create policy club_match_read on public.club_match
  for select to anon, authenticated using (true);

-- Справочник, составы и матчи — открытые футбольные данные, личного в них нет.
grant select on public.football_club to anon, authenticated;
grant select on public.club_squad    to anon, authenticated;
grant select on public.club_match    to anon, authenticated;

-- ⚠️ club_alias, club_alias_seed и club_name_seen игрокам НЕ отдаются: это
-- внутренняя кухня сведения названий, экрану её читать незачем. Резолвер —
-- security definer и читает их правами владельца.
grant select, insert, update, delete on public.football_club   to service_role;
grant select, insert, update, delete on public.club_alias      to service_role;
grant select, insert, update, delete on public.club_alias_seed to service_role;
grant select, insert, update, delete on public.club_name_seen  to service_role;
grant select, insert, update, delete on public.club_squad      to service_role;
grant select, insert, update, delete on public.club_match      to service_role;

revoke all on function public.rebuild_football_clubs() from public, anon, authenticated;
revoke all on function public.build_club_aliases()     from public, anon, authenticated;
revoke all on function public.prune_orphan_clubs()     from public, anon, authenticated;
revoke all on function public.rebuild_club_squads()    from public, anon, authenticated;
revoke all on function public.rebuild_club_matches()   from public, anon, authenticated;
grant execute on function public.rebuild_football_clubs() to service_role;
grant execute on function public.build_club_aliases()     to service_role;
grant execute on function public.prune_orphan_clubs()     to service_role;
grant execute on function public.rebuild_club_squads()    to service_role;
grant execute on function public.rebuild_club_matches()   to service_role;

grant execute on function public.is_national_tournament(text)  to anon, authenticated, service_role;
grant execute on function public.tournament_scope(text)        to anon, authenticated, service_role;
grant execute on function public.resolve_club_key(text, text)  to anon, authenticated, service_role;
grant execute on function public.club_display_name(text, text) to anon, authenticated, service_role;
grant execute on function public.club_profile(text, text, integer)           to anon, authenticated, service_role;
grant execute on function public.club_squad_list(text, text, integer)        to anon, authenticated, service_role;
grant execute on function public.club_recent_matches(text, text, integer)    to anon, authenticated, service_role;
grant execute on function public.club_upcoming_fixtures(text, text, integer) to anon, authenticated, service_role;
grant execute on function public.club_directory(text, text, integer)         to anon, authenticated, service_role;
grant execute on function public.club_of_card(uuid, text)                    to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. merge_seeded_clubs — свести ЗАПИСИ справочника, а не только псевдонимы.
--
-- ⚠️ БЕЗ ЭТОГО ШАГА СВЕДЕНИЕ ВЫГЛЯДИТ СДЕЛАННЫМ, А ЭКРАН ОСТАЁТСЯ ПУСТЫМ, и
-- это замерено. «Зенит» собрал 18 игроков и 20 матчей под ключом
-- `zenit st petersburg`, а карточка клуба — с эмблемой, страной и переводами
-- на восемь языков — лежала под `zenith`, тем самым неверным name_en. То
-- есть данные сошлись, а показать их было нечем: club_profile отдавал
-- crest_url = NULL и card_id = NULL, и команда рисовалась безымянной
-- заглушкой с правильной таблицей результатов.
-- ---------------------------------------------------------------------------
create or replace function public.merge_seeded_clubs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update football_club t
     set card_id   = coalesce(t.card_id, src.card_id),
         name      = case when t.card_id is null and src.card_id is not null
                          then src.name else t.name end,
         name_en   = coalesce(t.name_en, src.name_en),
         crest_url = coalesce(t.crest_url, src.crest_url),
         country   = coalesce(t.country, src.country)
    from football_club src
    join club_alias_seed s on s.scope = '' and src.club_key = s.alias_key
   where t.club_key = s.club_key and src.club_key <> t.club_key;

  -- Старый ключ после переезда — пустая запись, ведущая на пустой экран.
  delete from football_club src
   using club_alias_seed s
   where s.scope = '' and src.club_key = s.alias_key and s.club_key <> src.club_key;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.merge_seeded_clubs() is
  'Переносит карточку, эмблему и страну со старого ключа на тот, который '
  'назвал человек в club_alias_seed, и убирает старую запись.';

revoke all on function public.merge_seeded_clubs() from public, anon, authenticated;
grant execute on function public.merge_seeded_clubs() to service_role;

-- ---------------------------------------------------------------------------
-- 13. rebuild_clubs_all — ПОРЯДОК, а не просто удобство.
--
-- Шаги зависят друг от друга, и переставить их местами значит получить
-- правдоподобно выглядящую чепуху:
--
--   1. rebuild_football_clubs  — справочник и словарь; без словаря ни один
--                                следующий шаг не знает, что «Зенит» и
--                                «Zenit St Petersburg» — одно и то же.
--   2. merge_seeded_clubs      — свести записи; ДО составов, потому что состав
--                                собирается по club_key, и собранный на старый
--                                ключ он остался бы у удалённой записи.
--   3. rebuild_club_squads     — составы.
--   4. rebuild_club_matches    — матчи команд.
--   5. prune_orphan_clubs      — уборка; ПОСЛЕ составов и матчей, иначе она
--                                считает осиротевшим всё подряд.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_clubs_all()
returns table (clubs integer, merged integer, squad integer, matches integer, pruned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clubs integer; v_merged integer; v_squad integer; v_matches integer; v_pruned integer;
begin
  v_clubs   := rebuild_football_clubs();
  v_merged  := merge_seeded_clubs();
  v_squad   := rebuild_club_squads();
  v_matches := rebuild_club_matches();
  v_pruned  := prune_orphan_clubs();
  return query select v_clubs, v_merged, v_squad, v_matches, v_pruned;
end;
$$;

comment on function public.rebuild_clubs_all() is
  'Весь конвейер клубов одним вызовом, в единственном правильном порядке. '
  'Возвращает числа по каждому шагу — чтобы «отработало» отличалось от '
  '«отработало и ничего не нашло».';

revoke all on function public.rebuild_clubs_all() from public, anon, authenticated;
grant execute on function public.rebuild_clubs_all() to service_role;
