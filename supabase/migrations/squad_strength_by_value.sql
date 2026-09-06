-- Сила состава в прогнозах — ПО РЫНОЧНОЙ СТОИМОСТИ, а не по славе.
--
-- Владелец: «добавь в прогнозы всех игроков по стоимости вместо рейтинга».
--
-- ПОЧЕМУ ЭТО ПОЧИНКА, А НЕ ПРЕДПОЧТЕНИЕ. Слава — перцентиль ПРОСМОТРОВ
-- ВИКИПЕДИИ, то есть известность, а не футбольная сила. И она есть у
-- меньшинства: замер 06.09.2026 — активных игроков 25 509, со славой 2 906,
-- со стоимостью 20 715. Прежний отбор (`c.fame is not null`) выбрасывал
-- четыре пятых колоды, и заведение новых игроков прогноз не двигало вовсе —
-- в docs/MAP.md это записано прямо: «ГОЛАЯ КАРТОЧКА СОСТАВ НЕ РАСТИТ».
--
-- ЗАМЕР ПОКРЫТИЯ, тот же час: матчей, где у ОБОИХ клубов набирается пятеро,
--     по славе      34
--     по стоимости 140
--
-- ⚠️ ИМЕНА КОЛОНОК ОСТАВЛЕНЫ ПРЕЖНИМИ (`home_fame`/`away_fame`): их читает
-- прод. Менять смысл и имя в один шаг — способ уронить экран молча.
--
-- ⚠️ ЕДИНИЦЫ — МИЛЛИОНЫ ЕВРО: среднее по составу в сырых евро даёт
-- девятизначное число, и на экране это нечитаемо.

create or replace function public.fixture_squad_strength(p_min_depth integer default 5)
returns table(fixture_id text, home_fame numeric, away_fame numeric, depth integer, home_squad integer, away_squad integer)
language sql
stable
security definer
set search_path = public
as $function$
  with p as (
    select cc.club_key,
           c.market_value_eur / 1000000.0 as value_m,
           row_number() over (partition by cc.club_key
                              order by c.market_value_eur desc) as rn
      from card_current_club cc
      join cards c on c.id = cc.card_id
     where c.active and c.category = 'player' and c.market_value_eur is not null
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
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  )
  select s.id,
         round(avg(ph.value_m)::numeric, 1),
         round(avg(pa.value_m)::numeric, 1),
         s.depth, s.hn, s.an
    from sized s
    join p ph on ph.club_key = s.hk and ph.rn <= s.depth
    join p pa on pa.club_key = s.ak and pa.rn <= s.depth
   group by s.id, s.depth, s.hn, s.an
$function$;

revoke all on function public.fixture_squad_strength(integer) from public;
grant execute on function public.fixture_squad_strength(integer) to anon, authenticated, service_role;
