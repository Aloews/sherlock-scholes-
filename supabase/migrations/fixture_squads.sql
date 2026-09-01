-- ===========================================================================
-- fixture_squads — ИЗ КОГО складывается рейтинг команд в прогнозах.
--
-- Владелец: «доделай все составы команд (по уровню игроков) в прогнозах».
-- `fixture_team_rating` отдаёт ЧИСЛО — среднее по верхушке состава, — но не
-- говорит, чьё оно. Число без состава нечем проверить: «Зенит 68.8» одинаково
-- выглядит и когда команда действительно такая, и когда в составе три
-- случайных человека.
--
-- ⚠️ ГЛУБИНА ТУ ЖЕ, ЧТО В РЕЙТИНГЕ, И ЭТО ГЛАВНОЕ. Рейтинг считается по
-- РАВНОМУ числу лучших с обеих сторон (клубы оцифрованы неравномерно, и
-- наивное среднее сравнивало бы ВЕСЬ состав одного со ЗВЁЗДАМИ другого).
-- Показать здесь все строки подряд значило бы показать не тот состав, по
-- которому посчитано число: экран и рейтинг разошлись бы, оба выглядя верно.
-- Поэтому `in_rating` помечает тех, кто в расчёт вошёл, а остальные идут ниже
-- как остальной состав.
-- ===========================================================================
create or replace function public.fixture_squads(
  p_fixture_id text,
  p_lang       text default 'ru'
)
returns table (
  side       text,      -- 'home' | 'away'
  club_key   text,
  club       text,
  card_id    uuid,
  name       text,
  level      smallint,
  basis      text,      -- откуда уровень: 'form' | 'fame' | 'icon'
  in_rating  boolean
)
language sql stable security definer set search_path = public as $$
  with fx as (
    select f.id,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.id = p_fixture_id
  ),
  sides as (
    select 'home'::text as side, fx.hk as club_key from fx
    union all
    select 'away', fx.ak from fx
  ),
  ranked as (
    select s.side, s.club_key, q.card_id, c.name, l.level, l.basis,
           row_number() over (partition by s.side order by l.level desc, c.name) as rn
      from sides s
      join club_squad q on q.club_key = s.club_key and q.left_at is null
      join player_level l on l.card_id = q.card_id
      join cards c on c.id = q.card_id and c.active and c.category = 'player'
  ),
  -- Та же глубина, что берёт fixture_team_rating: минимум из двух составов,
  -- не больше одиннадцати.
  depth as (
    select least(
      (select count(*) from ranked where side = 'home'),
      (select count(*) from ranked where side = 'away'),
      11) as n
  )
  select r.side, r.club_key, club_display_name(r.club_key, p_lang),
         r.card_id, r.name, r.level, r.basis,
         r.rn <= (select n from depth)
    from ranked r
   order by r.side desc, r.level desc, r.name;
$$;

-- Грант перечислен ЯВНО: политика без гранта роняла этот проект дважды.
revoke all on function public.fixture_squads(text, text) from public;
grant execute on function public.fixture_squads(text, text)
  to anon, authenticated, service_role;
