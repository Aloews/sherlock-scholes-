-- Тур фэнтези резался посреди игровой недели.
--
-- ЖАЛОБА БЫЛА «НЕТ ЧЕЛСИ В ВЫБОРЕ», И ЭТО НЕ ПРО ЧЕЛСИ. Карточки на месте,
-- клуб сопоставляется правильно:
--
--   card_current_club: 25 карточек с club_key = 'chelsea'
--   club_match_key('Chelsea') = 'chelsea'   ← совпадает
--
-- Единственный матч Челси в расписании — «Fulham – Chelsea, 24.08 19:00».
-- Окно второго тура: 17.08 00:00 → 24.08 00:00. Матч начинается на
-- ДЕВЯТНАДЦАТЬ ЧАСОВ позже конца тура, и Челси выпадает целиком.
--
-- Причина — date_trunc('week'), который в Postgres даёт ПОНЕДЕЛЬНИК. Тур
-- получался с понедельника по понедельник, а матчи тура в Европе идут с
-- пятницы по понедельник включительно. Граница проходила по живому.
--
-- Это не единичный случай: 20 матчей из 220 в расписании играются в
-- понедельник — 9% всего футбола и 40 команд. Каждый такой матч оказывался
-- либо в начале своего тура, либо за концом предыдущего, и по какую сторону
-- полуночи он упадёт — вопрос случая, а не смысла.
--
-- Неделя европейского футбола идёт со ВТОРНИКА: вторник-среда еврокубки,
-- пятница-понедельник лига. Вторник — единственная точка, где ничего не
-- разрезано.

/**
 * Начало игровой недели, в которой лежит момент.
 *
 * Отдельной функцией, потому что это правило теперь в трёх местах, и три
 * копии `date_trunc(...) + interval '1 day'` разойдутся при первой же правке.
 */
create or replace function public.fantasy_week_start(p_at timestamptz default now())
returns timestamptz
language sql immutable set search_path = public as $$
  -- Сдвиг на день назад, обрезка до понедельника, сдвиг вперёд: получается
  -- вторник, ближайший СЛЕВА от момента. Без первого сдвига понедельничный
  -- матч попал бы в неделю, которая начинается после него.
  select date_trunc('week', (p_at at time zone 'utc') - interval '1 day')
         at time zone 'utc' + interval '1 day';
$$;

revoke all on function public.fantasy_week_start(timestamptz) from public;
grant execute on function public.fantasy_week_start(timestamptz)
  to anon, authenticated, service_role;

create or replace function public.current_fantasy_round()
returns public.fantasy_round
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := fantasy_week_start();
  v_round fantasy_round;
begin
  select * into v_round from fantasy_round where starts_at = v_start;
  if found then return v_round; end if;
  insert into fantasy_round (starts_at, ends_at) values (v_start, v_start + interval '7 days')
  on conflict (starts_at) do update set ends_at = excluded.ends_at returning * into v_round;
  return v_round;
end;
$$;
