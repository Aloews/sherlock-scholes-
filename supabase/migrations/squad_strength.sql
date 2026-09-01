-- ============================================================================
-- fixture_squad_strength — УРОВЕНЬ СОСТАВА вместо истории противостояний.
--
-- ЗАЧЕМ. Просили ИИ-анализ истории встреч. Его не из чего строить, и это
-- измерено: в `fixtures` 0 из 266 предстоящих матчей имеют хоть одну прошлую
-- встречу, на команду в среднем 1.1 сыгранный матч. Владелец предложил замену:
-- «тогда оценивай команды по уровню состава футболистов». Вот она.
--
-- ЧТО ЭТО ЗА ЧИСЛО И ЧЕМ ОНО НЕ ЯВЛЯЕТСЯ. Это средняя ИЗВЕСТНОСТЬ (`cards.fame`,
-- 0..100, построена по википедийным просмотрам) игроков клуба. Известность —
-- не мастерство и не форма: ветеран на излёте карьеры известнее талантливого
-- дебютанта. Поэтому число подписано «состав», а не «сила», и НЕ является ни
-- прогнозом, ни вероятностью.
--
-- ⚠️ РАВНАЯ ГЛУБИНА — НЕ ПРИДИРКА, А ИСПРАВЛЕНИЕ ПЕРЕКОСА. Оцифрованы клубы
-- очень неравномерно: у «Реала» 20 карточек, у «Реала Сосьедад» — 5. Наивное
-- среднее по всем сравнивало бы ВЕСЬ состав одного с ЗВЁЗДАМИ другого: у
-- бедно оцифрованного клуба в карточки попали только знаменитости, и его
-- среднее завышено. Замер: «Арсенал» по всем карточкам 87.7, по одиннадцати
-- самым известным — 97.1.
--
-- Поэтому сравниваются N самых известных с КАЖДОЙ стороны, где N — сколько
-- есть у более бедной стороны, но не больше 11 (это размер стартового
-- состава, дальше сравнивать нечего).
--
-- ⚠️ СРАВНИВАТЬ МЕЖДУ ЛИГАМИ НЕЛЬЗЯ. Известность считается по википедии, а она
-- сильно зависит от языка и внимания: РПЛ даёт 18–32, АПЛ 60–97. Внутри одного
-- матча это не мешает — обе команды почти всегда из одной лиги, — но
-- складывать эти числа в общую таблицу лиг нельзя.
--
-- ПОКРЫТИЕ ЧЕСТНО МАЛОЕ, и функция это возвращает, а не прячет:
--   268 предстоящих матчей
--    74 обе команды есть в карточках вообще
--    23 у обеих не меньше пяти игроков   ← порог функции
--    10 у обеих не меньше одиннадцати
-- Зато оставшиеся 23 — это ровно те матчи, ради которых экран открывают:
-- Реал, Барселона, Бавария, Ман Сити, Ливерпуль, Арсенал плюс РПЛ.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

create or replace function public.fixture_squad_strength(p_min_depth int default 5)
returns table (
  fixture_id text,
  home_fame numeric,
  away_fame numeric,
  depth int,
  home_squad int,
  away_squad int
)
language sql stable security definer set search_path = public as $$
  with p as (
    select cc.club_key, c.fame,
           row_number() over (partition by cc.club_key order by c.fame desc) as rn
      from card_current_club cc
      join cards c on c.id = cc.card_id
     where c.active and c.category = 'player' and c.fame is not null
  ),
  sz as (select p.club_key, count(*)::int as n from p group by p.club_key),
  fx as (
    select f.id, club_match_key(f.home_team) as hk, club_match_key(f.away_team) as ak
      from fixtures f
     where f.commence_at >= now() and not f.completed
  ),
  sized as (
    select fx.id, fx.hk, fx.ak, hz.n as hn, az.n as an,
           least(hz.n, az.n, 11) as depth
      from fx
      join sz hz on hz.club_key = fx.hk
      join sz az on az.club_key = fx.ak
     -- Порог обязателен. По двум карточкам «уровень состава» — это уровень
     -- двух человек, и подписать его именем клуба значит соврать.
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  )
  select s.id,
         round(avg(ph.fame)::numeric, 1),
         round(avg(pa.fame)::numeric, 1),
         s.depth, s.hn, s.an
    from sized s
    join p ph on ph.club_key = s.hk and ph.rn <= s.depth
    join p pa on pa.club_key = s.ak and pa.rn <= s.depth
   group by s.id, s.depth, s.hn, s.an
$$;

comment on function public.fixture_squad_strength(int) is
  'Средняя известность (cards.fame) N самых известных игроков каждой команды, '
  'N — по более бедной стороне, максимум 11. НЕ прогноз и НЕ вероятность: '
  'известность не равна мастерству. Между лигами не сравнивается.';

revoke all on function public.fixture_squad_strength(int) from public;
grant execute on function public.fixture_squad_strength(int) to anon, authenticated, service_role;

-- ============================================================================
-- fixture_team_rating — РЕЙТИНГ КОМАНД ИЗ УРОВНЕЙ ИХ ИГРОКОВ.
--
-- Владелец: «на основе рейтинга игроков команды составляется рейтинг команды
-- в прогнозах». Функция выше этого не делала — она считала среднюю
-- ИЗВЕСТНОСТЬ, а известность не мастерство: ветеран на излёте известнее
-- сильного дебютанта, и это записано в её же шапке как ограничение.
--
-- ЧТО ИМЕННО ЗАМЕНЕНО, ПО ПУНКТАМ:
--
--   1. `cards.fame` → `player_level.level`. Уровень наполовину известность и
--      наполовину перцентиль отдачи за матч, то есть в нём есть игра, а не
--      только внимание.
--   2. `card_current_club` → `club_squad`. Составы теперь собираются из трёх
--      свидетельств и переживают переходы.
--   3. ⚠️ `club_match_key` → `resolve_club_key`. ЭТО САМОЕ ВАЖНОЕ ИЗ ТРЁХ.
--      Старый ключ не проходит через словарь псевдонимов, и клуб из
--      `fixtures` (латиница, the-odds-api) не находил собственного состава,
--      собранного по кириллическим матчам. Замер замены на боевых данных:
--
--        обе команды известны   76 → 102 матча
--        глубина ≥ 5            23 →  37
--        глубина ≥ 11                 16
--
--   4. Добавлена ФОРМА — `club_rating.level`, Эло по результатам. Состав
--      говорит, КТО в команде; форма — что она СДЕЛАЛА. Взвешены поровну, по
--      той же причине, что и в `player_level`: перевес пришлось бы
--      обосновывать замером, которого нет.
--
-- ⚠️ РАВНАЯ ГЛУБИНА СОХРАНЕНА, и это по-прежнему не придирка: клубы
-- оцифрованы неравномерно, и наивное среднее сравнивало бы ВЕСЬ состав одного
-- со ЗВЁЗДАМИ другого.
--
-- ⚠️ МЕЖДУ ЛИГАМИ НЕ СРАВНИВАЕТСЯ, как и раньше. Замер на новом основании:
-- у РПЛ выходит 30–40 там, где у АПЛ 68–86. Внутри матча это не мешает — обе
-- команды почти всегда из одной лиги.
--
-- ⚠️ `fixture_squad_strength` ВЫШЕ НЕ УДАЛЕНА И НЕ ИЗМЕНЕНА. Её зовёт
-- выкаченный фронтенд, а удаление функции, которую зовёт прод, один раз уже
-- уронило это приложение (легаси-шим `pick_random_cards`, docs/MAP.md §3).
-- Удалять — после того, как новая сборка разойдётся везде:
--
--   drop function public.fixture_squad_strength(int);
-- ============================================================================

create or replace function public.fixture_team_rating(p_min_depth int default 5)
returns table (
  fixture_id       text,
  home_squad_level numeric,
  away_squad_level numeric,
  home_form_level  smallint,
  away_form_level  smallint,
  home_rating      numeric,
  away_rating      numeric,
  basis            text,
  depth            int,
  home_squad       int,
  away_squad       int,
  min_league_weight numeric
)
language sql stable security definer set search_path = public as $$
  with p as (
    select q.club_key, l.level,
           row_number() over (partition by q.club_key order by l.level desc) as rn
      from club_squad q
      join player_level l on l.card_id = q.card_id
      join cards c on c.id = q.card_id and c.active and c.category = 'player'
     where q.left_at is null
  ),
  sz as (select p.club_key, count(*)::int as n from p group by p.club_key),
  fx as (
    select f.id,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.commence_at >= now() and not f.completed
  ),
  sized as (
    select fx.id, fx.hk, fx.ak, hz.n as hn, az.n as an,
           least(hz.n, az.n, 11) as depth
      from fx
      join sz hz on hz.club_key = fx.hk
      join sz az on az.club_key = fx.ak
     -- Порог обязателен. По двум карточкам «уровень состава» — это уровень
     -- двух человек, и подписать его именем клуба значит соврать.
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  ),
  squad as (
    select s.id, s.depth, s.hn, s.an, s.hk, s.ak,
           round(avg(ph.level)::numeric, 1) as hl,
           round(avg(pa.level)::numeric, 1) as al
      from sized s
      join p ph on ph.club_key = s.hk and ph.rn <= s.depth
      join p pa on pa.club_key = s.ak and pa.rn <= s.depth
     group by s.id, s.depth, s.hn, s.an, s.hk, s.ak
  )
  select q.id, q.hl, q.al,
         hr.level, ar.level,
         case when hr.level is null then q.hl else round((q.hl + hr.level) / 2.0, 1) end,
         case when ar.level is null then q.al else round((q.al + ar.level) / 2.0, 1) end,
         case when hr.level is null or ar.level is null then 'squad' else 'squad+form' end,
         q.depth, q.hn, q.an,
         -- Худший из двух: если хоть одна команда из лиги-острова, сравнение
         -- между ними тем и ограничено.
         least(coalesce(hr.league_weight, 1), coalesce(ar.league_weight, 1))
    from squad q
    left join club_rating hr on hr.club_key = q.hk
    left join club_rating ar on ar.club_key = q.ak
$$;

comment on function public.fixture_team_rating(int) is
  'Рейтинг команд предстоящего матча ИЗ УРОВНЕЙ ИХ ИГРОКОВ (player_level) плюс '
  'форма по результатам (club_rating). НЕ прогноз и НЕ вероятность.';

revoke all on function public.fixture_team_rating(int) from public;
grant execute on function public.fixture_team_rating(int) to anon, authenticated, service_role;
