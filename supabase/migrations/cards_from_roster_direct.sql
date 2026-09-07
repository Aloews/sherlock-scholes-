-- Карточка игрока — прямо из заявки клуба, БЕЗ Викиданных.
--
-- ЗАЧЕМ. Прежний путь заведения требовал QID: `cards_from_roster.py` идёт
-- «id на Transfermarkt → (P2446, обратно) → QID → ярлыки». Замер 06.09.2026 на
-- живом прогоне: из 3000 проверенных игроков заявок QID нашёлся у 50. То есть
-- 98% футболистов мира в колоду не попадали В ПРИНЦИПЕ — у них просто нет
-- статьи ни на одном языке.
--
-- Владелец: «за весь месяц так и не добавились игроки, не разбились по
-- странам и командам и не добавилась стоимость».
--
-- ⚠️ ГОЛОЙ КАРТОЧКА НЕ ВЫХОДИТ, И ЭТО ГЛАВНОЕ ВОЗРАЖЕНИЕ, КОТОРОЕ СНЯТО.
-- В проекте записано «заводить недостающим голые карточки нельзя, колода уже
-- портилась так» — но заявка клуба несёт ИМЯ ЛАТИНИЦЕЙ, ПОЗИЦИЮ, ГРАЖДАНСТВО,
-- РЫНОЧНУЮ СТОИМОСТЬ и id на Transfermarkt. Пусто остаётся только фото и
-- слава, и их доберут адресные сборщики.
--
-- ⚠️ КАРТА «СТРАНА СЛОВОМ → КОД» СТРОИТСЯ ИЗ СВОИХ ЖЕ ДАННЫХ, а не вторым
-- словарём: у связанных карточек уже есть и `country`, и строка заявки с
-- `nationality`; берётся самый частый код на написание. Второй словарь
-- разошёлся бы с первым молча.
--
-- РЕЗУЛЬТАТ ПЕРВОГО ПРОГОНА: заведено 6394 карточки, связано 6397 строк
-- заявок. Игроков стало 25 509, со стоимостью 20 715, со страной 25 233.

create or replace function public.create_cards_from_roster_direct(p_limit integer default 20000)
returns table(created integer, linked integer, with_value integer, with_country integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_created integer := 0;
  v_linked  integer := 0;
  v_value   integer := 0;
  v_country integer := 0;
begin
  create temp table _ctry on commit drop as
  select r.nationality, c.country, count(*) as n
    from club_roster r
    join cards c on c.id = r.card_id
   where r.nationality is not null and c.country is not null
   group by 1, 2;

  create temp table _ctry_best on commit drop as
  select distinct on (nationality) nationality, country
    from _ctry order by nationality, n desc;

  -- Один игрок — одна карточка: по tm_player_id, и только те, кого ещё нет.
  create temp table _new on commit drop as
  select distinct on (r.tm_player_id)
         r.tm_player_id,
         btrim(r.name)            as name,
         r.position               as position_en,
         r.nationality,
         r.market_value_eur
    from club_roster r
   where r.card_id is null
     and coalesce(btrim(r.name), '') <> ''
     and r.tm_player_id is not null
     and not exists (select 1 from cards c where c.transfermarkt_id = r.tm_player_id)
   order by r.tm_player_id, r.market_value_eur desc nulls last
   limit greatest(1, p_limit);

  with ins as (
    insert into cards (name, name_en, category, category_ru, active, langs,
                       transfermarkt_id, position_ru, country, market_value_eur,
                       difficulty)
    select n.name, n.name, 'player', 'Игроки', true, null,
           n.tm_player_id,
           case n.position_en
             when 'Goalkeeper' then 'Вратарь'
             when 'Defender'   then 'Защитник'
             when 'Midfield'   then 'Полузащитник'
             when 'Attack'     then 'Нападающий'
           end,
           (select b.country from _ctry_best b where b.nationality = n.nationality),
           n.market_value_eur,
           'medium'
      from _new n
    returning 1
  )
  select count(*) from ins into v_created;

  with upd as (
    update club_roster r set card_id = c.id
      from cards c
     where r.card_id is null and c.transfermarkt_id = r.tm_player_id and c.active
    returning 1
  )
  select count(*) from upd into v_linked;

  select count(*) filter (where market_value_eur is not null),
         count(*) filter (where country is not null)
    into v_value, v_country
    from cards where active and category = 'player';

  return query select v_created, v_linked, v_value, v_country;
end;
$function$;

revoke all on function public.create_cards_from_roster_direct(integer) from public;
grant execute on function public.create_cards_from_roster_direct(integer) to service_role;
