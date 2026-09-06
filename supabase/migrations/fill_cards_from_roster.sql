-- Статистика карточке — из состава клуба, по идентификатору.
--
-- ЗАЧЕМ. После заведения карточек из ростера у 3700 игроков не было НИЧЕГО:
-- ни позиции, ни стоимости, ни страны. Досье у них открывалось пустым.
-- А данные при этом уже лежали рядом, в `club_roster`: позиция, гражданство,
-- рыночная стоимость и номер — всё выкачано со страницы клуба.
--
-- ⚠️ СВЯЗЬ ПО `card_id`, А НЕ ПО ИМЕНИ. Строка ростера связана с карточкой
-- через `link_roster_to_cards`/`create_cards_from_roster`, то есть через
-- id на Transfermarkt и QID. Сопоставления имён здесь нет ни одного.
--
-- ⚠️ ИГРОК В ДВУХ СОСТАВАХ — ОТКАЗ, А НЕ ВЫБОР. Аренда даёт две строки с
-- разной стоимостью, и брать «какую-нибудь» нельзя. Берём, только если
-- значение по всем его строкам ОДНО.
--
-- ⚠️ ПОЗИЦИЯ ПЕРЕВОДИТСЯ СЛОВАРЁМ ИЗ ЧЕТЫРЁХ СТРОК, И ЭТО ВЕСЬ СЛОВАРЬ.
-- В ростере ровно `Attack, Defender, Goalkeeper, Midfield`, в колоде ровно
-- `Нападающий, Защитник, Вратарь, Полузащитник`. Неизвестное значение НЕ
-- пишется: появится пятое — увидим по недобору, а не по мусору в колоде.
--
-- ⚠️ НИЧЕГО НЕ ПЕРЕЗАПИСЫВАЕТСЯ. Заполняется только пустое: у старых
-- карточек позиция и стоимость собраны другими путями и точнее.

create or replace function public.fill_cards_from_roster()
returns table(position_set integer, value_set integer, country_set integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pos integer := 0;
  v_val integer := 0;
  v_ctr integer := 0;
begin
  -- Однозначные значения игрока по всем его строкам ростера.
  create temp table _one on commit drop as
  select r.card_id,
         min(r."position")        as position_en,
         min(r.market_value_eur)  as value_eur,
         min(r.nationality)       as nationality
    from club_roster r
   where r.card_id is not null
   group by r.card_id
  having count(distinct r."position") <= 1
     and count(distinct r.market_value_eur) <= 1
     and count(distinct r.nationality) <= 1;

  create index on _one (card_id);

  with pos as (
    update cards c
       set position_ru = case o.position_en
                           when 'Goalkeeper' then 'Вратарь'
                           when 'Defender'   then 'Защитник'
                           when 'Midfield'   then 'Полузащитник'
                           when 'Attack'     then 'Нападающий'
                         end
      from pg_temp._one o
     where c.id = o.card_id
       and c.position_ru is null
       and o.position_en in ('Goalkeeper','Defender','Midfield','Attack')
    returning 1
  )
  select count(*) into v_pos from pos;

  with val as (
    update cards c
       set market_value_eur = o.value_eur,
           market_value_at  = coalesce(c.market_value_at, current_date)
      from pg_temp._one o
     where c.id = o.card_id
       and c.market_value_eur is null
       and o.value_eur is not null
    returning 1
  )
  select count(*) into v_val from val;

  -- Страна — ТОЛЬКО через справочник кодов, а не по названию из ростера.
  -- «Spain» → 'ES' отображением в питоне стало бы второй копией правила;
  -- здесь опорой служат страны, уже проставленные в колоде другими путями.
  with iso as (
    select distinct on (lower(btrim(x.nat))) lower(btrim(x.nat)) as nat, x.code
      from (
        select r.nationality as nat, c2.country as code
          from club_roster r
          join cards c2 on c2.id = r.card_id
         where r.nationality is not null and c2.country is not null
      ) x
     group by lower(btrim(x.nat)), x.code
    having count(*) >= 3            -- одиночное совпадение — не словарь
     order by lower(btrim(x.nat)), count(*) desc
  ),
  ctr as (
    update cards c
       set country = i.code
      from pg_temp._one o
      join iso i on i.nat = lower(btrim(o.nationality))
     where c.id = o.card_id and c.country is null
    returning 1
  )
  select count(*) into v_ctr from ctr;

  drop table pg_temp._one;
  return query select v_pos, v_val, v_ctr;
end;
$function$;

comment on function public.fill_cards_from_roster() is
  'Переносит позицию, стоимость и страну из club_roster в карточку по card_id. '
  'Заполняет только пустое; игрока с расхождением между составами пропускает.';

revoke all on function public.fill_cards_from_roster() from public;
grant execute on function public.fill_cards_from_roster() to service_role;
