-- Soccer Wiki, страница игрока: рост, вес, нога, дата рождения, фото.
--
-- ЗАЧЕМ ВТОРОЙ ЗАХОД, КОГДА СОСТАВ УЖЕ СОБРАН. `soccerwiki.sql` рядом берёт
-- со страницы клуба всё, что там есть: номер, позицию, возраст, рейтинг —
-- один запрос на весь состав. Роста, ноги и ДАТЫ РОЖДЕНИЯ там нет вовсе, они
-- живут только на /player.php?pid=…, то есть стоят по запросу на игрока.
-- Поэтому шаг отдельный и идёт ТОЛЬКО по связанным с колодой: 12 814 запросов
-- против 49 923.
--
-- ЧТО ИМЕННО ОТДАЁТ СТРАНИЦА, ЗАМЕРЕНО 07.09.2026 НА pid=147713:
--   Full Name: Ângelo Samuel Chaves | Position: D,DM,M(L) | Rating: 68
--   Age: 25 (Feb 10, 2001) | Nation: Brazil | Height (cm): 182
--   Weight (kg): 81 | Preferred Foot: Left | Position Desc: Wingback
--
-- ⚠️ ДАТА РОЖДЕНИЯ ЗАПОЛНЯЕТ `cards.born_on` ТОЛЬКО ТАМ, ГДЕ ЕГО НЕТ. У 3277
-- активных карточек даты нет ни от Викиданных, ни от Transfermarkt, и в
-- карточке вместо неё стоит пустое место — владелец просил показывать дату
-- рождения, когда нет ни матчей за сборную, ни числа лиг. Но затирать дату,
-- ПРИШЕДШУЮ ИЗ ВИКИДАННЫХ, данными, которые правят читатели, нельзя: у Soccer
-- Wiki это «for the fans, by the fans», и точность там другого порядка.
-- Поэтому `where cards.born_on is null` — и это не осторожность, а порядок
-- источников.

alter table public.soccerwiki_player add column if not exists full_name     text;
alter table public.soccerwiki_player add column if not exists born_on       date;
alter table public.soccerwiki_player add column if not exists nation        text;
alter table public.soccerwiki_player add column if not exists nation_code   text;
alter table public.soccerwiki_player add column if not exists height_cm     smallint;
alter table public.soccerwiki_player add column if not exists weight_kg     smallint;
alter table public.soccerwiki_player add column if not exists foot          text;
alter table public.soccerwiki_player add column if not exists position_desc text;
alter table public.soccerwiki_player add column if not exists photo_url     text;
-- Когда страница игрока была прочитана. NULL — не читалась ни разу, и по
-- этому полю сборщик и выбирает, кого брать дальше.
alter table public.soccerwiki_player add column if not exists detail_at     timestamptz;

create index if not exists soccerwiki_player_detail_idx
  on public.soccerwiki_player (detail_at nulls first)
  where card_id is not null;

-- Пачка страниц игроков — одной транзакцией.
--
-- ⚠️ ЧИСЛА ПРОВЕРЯЮТСЯ ЗДЕСЬ, А НЕ В ПИТОНЕ. Рост 182 и рост 1820 приходят
-- одинаковым текстом со страницы, которую правят читатели; отсев по здравым
-- границам должен стоять там же, где запись, иначе второй сборщик его
-- обойдёт. Границы взяты с запасом: 140–220 см, 40–140 кг.
create or replace function public.apply_soccerwiki_details(p_rows jsonb)
returns table(saved integer, born_filled integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_saved integer := 0;
  v_born  integer := 0;
begin
  with raw as (
    select distinct on (pid) *
      from (
        select (r->>'pid')::integer                      as pid,
               nullif(btrim(r->>'full_name'), '')        as full_name,
               nullif(r->>'born_on', '')::date           as born_on,
               nullif(btrim(r->>'nation'), '')           as nation,
               nullif(btrim(r->>'nation_code'), '')      as nation_code,
               nullif(r->>'height_cm', '')::integer      as height_cm,
               nullif(r->>'weight_kg', '')::integer      as weight_kg,
               nullif(btrim(r->>'foot'), '')             as foot,
               nullif(btrim(r->>'position_desc'), '')    as position_desc,
               nullif(btrim(r->>'photo_url'), '')        as photo_url,
               ord
          from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, ord)
         where coalesce(r->>'pid', '') <> ''
      ) s
     order by pid, ord
  ),
  upd as (
    update soccerwiki_player p
       set full_name     = raw.full_name,
           born_on       = raw.born_on,
           nation        = raw.nation,
           nation_code   = raw.nation_code,
           height_cm     = case when raw.height_cm between 140 and 220 then raw.height_cm end,
           weight_kg     = case when raw.weight_kg between  40 and 140 then raw.weight_kg end,
           foot          = raw.foot,
           position_desc = raw.position_desc,
           photo_url     = raw.photo_url,
           detail_at     = now()
      from raw
     where p.pid = raw.pid
    returning p.card_id, raw.born_on
  ),
  born as (
    -- Только там, где даты нет вовсе. См. шапку файла.
    update cards c set born_on = u.born_on
      from (select distinct card_id, born_on from upd
             where card_id is not null and born_on is not null) u
     where c.id = u.card_id and c.born_on is null
    returning 1
  )
  select (select count(*) from upd), (select count(*) from born) into v_saved, v_born;

  return query select v_saved, v_born;
end;
$function$;

comment on function public.apply_soccerwiki_details(jsonb) is
  'Пачка страниц игроков Soccer Wiki одной транзакцией. Заполняет cards.born_on '
  'ТОЛЬКО там, где даты нет: Викиданные точнее правок читателей.';

revoke all on function public.apply_soccerwiki_details(jsonb) from public;
grant execute on function public.apply_soccerwiki_details(jsonb) to service_role;


-- Досье карточки: что о ней говорит Soccer Wiki.
--
-- ⚠️ ОДНА СТРОКА, А НЕ НЕСКОЛЬКО. `card_id` в `soccerwiki_player` уникален по
-- построению (связывание не берёт неоднозначные пары), но `limit 1` стоит
-- явно: экран, которому пришли две строки, показал бы вторую молча.
create or replace function public.soccerwiki_card(p_card_id uuid)
returns table(
  pid           integer,
  full_name     text,
  "position"    text,
  position_desc text,
  shirt_number  integer,
  rating        integer,
  age           integer,
  born_on       date,
  nation        text,
  nation_code   text,
  height_cm     smallint,
  weight_kg     smallint,
  foot          text,
  club_name     text,
  club_key      text)
language sql
stable
security definer
set search_path = public
as $function$
  select p.pid, p.full_name, p.position, p.position_desc,
         nullif(p.shirt_number, 0), p.rating, p.age, p.born_on,
         p.nation, p.nation_code, p.height_cm, p.weight_kg, p.foot,
         sc.name, sc.club_key
    from soccerwiki_player p
    left join soccerwiki_club sc on sc.club_id = p.club_id
   where p.card_id = p_card_id
   limit 1;
$function$;

comment on function public.soccerwiki_card(uuid) is
  'Строка Soccer Wiki для досье карточки: рейтинг, позиция, рост, вес, нога.';

revoke all on function public.soccerwiki_card(uuid) from public;
grant execute on function public.soccerwiki_card(uuid) to anon, authenticated, service_role;


-- Состав клуба глазами Soccer Wiki: рейтинг у каждого, и это ЕДИНСТВЕННОЕ
-- место в проекте, где состав приходит с оценкой игрока.
--
-- ⚠️ ПОРЯДОК — ПО РЕЙТИНГУ, А НЕ ПО НОМЕРУ. Номера у половины состава нет
-- (`Squad Number: Unknown` на странице игрока), и сортировка по нему собрала
-- бы наверху экрана «пусто, пусто, пусто».
--
-- ⚠️ ПОТОЛОК 60 СТРОК НЕ ОТ ЛЕНИ: в заявке бывает и молодёжка, а PostgREST
-- режет ответ по `db-max-rows` МОЛЧА — этот проект на этом уже стоял.
create or replace function public.soccerwiki_squad(
  p_club_key text,
  p_limit    integer default 40)
returns table(
  pid          integer,
  name         text,
  card_id      uuid,
  photo_url    text,
  shirt_number integer,
  "position"   text,
  age          integer,
  rating       integer,
  height_cm    smallint,
  foot         text)
language sql
stable
security definer
set search_path = public
as $function$
  select p.pid, p.name, p.card_id, c.photo_url,
         nullif(p.shirt_number, 0), p.position, p.age, p.rating,
         p.height_cm, p.foot
    from soccerwiki_player p
    join soccerwiki_club sc on sc.club_id = p.club_id
    left join cards c on c.id = p.card_id and c.active
   where sc.club_key = p_club_key
   order by p.rating desc nulls last, p.name
   limit greatest(1, least(coalesce(p_limit, 40), 60));
$function$;

comment on function public.soccerwiki_squad(text, integer) is
  'Состав клуба с рейтингами Soccer Wiki, по убыванию рейтинга.';

revoke all on function public.soccerwiki_squad(text, integer) from public;
grant execute on function public.soccerwiki_squad(text, integer) to anon, authenticated, service_role;


-- Связывание составов с колодой ЦЕЛИКОМ, а не по клубу на записи.
--
-- ⚠️ ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОГОН, КОГДА `apply_soccerwiki_squad` УЖЕ СВЯЗЫВАЕТ.
-- Тот связывает в момент записи клуба — то есть по состоянию колоды НА ТОТ
-- МОМЕНТ. Всё, что появилось позже (новая карточка, починенный
-- `resolved_key`, доехавший `name_en`), остаётся несвязанным навсегда, потому
-- что клуб уже записан и второй раз не пишется.
--
-- Ровно это и случилось 07.09.2026: `card_current_club.resolved_key` был пуст
-- у 95% строк, составы записались, связалась четверть. После починки ключа
-- пересвязывать было нечем — до этой функции.
--
-- Правило сопоставления ТО ЖЕ, что в `apply_soccerwiki_squad`, и второй его
-- копии здесь нет по смыслу: точное имя в пределах клуба, неоднозначные пары
-- не берутся («Родри» — две разные активные карточки).
create or replace function public.link_soccerwiki_cards()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '240s'
as $function$
declare
  v_linked integer := 0;
begin
  with cand as (
    select p.pid, c.id as card_id
      from soccerwiki_player p
      join soccerwiki_club sc on sc.club_id = p.club_id
      join card_current_club cc on cc.resolved_key = sc.club_key
      join cards c on c.id = cc.card_id
     where p.card_id is null
       and c.active and c.name_en is not null
       and lower(btrim(c.name_en)) = lower(btrim(p.name))
  ),
  clean as (
    select d.* from cand d
     where 1 = (select count(*) from cand x where x.pid = d.pid)
       and 1 = (select count(*) from cand y where y.card_id = d.card_id)
       -- Карточка, уже занятая другим игроком источника, не берётся: иначе
       -- один человек колоды получил бы двух разных людей источника.
       and not exists (select 1 from soccerwiki_player p2 where p2.card_id = d.card_id)
  ),
  upd as (
    update soccerwiki_player p set card_id = k.card_id
      from clean k where p.pid = k.pid and p.card_id is null
    returning 1
  )
  select count(*) into v_linked from upd;

  return v_linked;
end;
$function$;

comment on function public.link_soccerwiki_cards() is
  'Пересвязывает составы Soccer Wiki с колодой по всем клубам. Идемпотентна: '
  'уже связанных не трогает, неоднозначных не берёт.';

revoke all on function public.link_soccerwiki_cards() from public;
grant execute on function public.link_soccerwiki_cards() to service_role;


-- Портрет с Soccer Wiki — ВТОРЫМ источником, и только там, где фото нет.
--
-- ЗАЧЕМ ВТОРОЙ ИСТОЧНИК, КОГДА ЕСТЬ TRANSFERMARKT. Замер 07.09.2026:
-- `cards_photo_transfermarkt.py` прошёл 850 карточек и нашёл ОДИН портрет —
-- у остальных на профиле стоит `portrait/big/default.jpg`, тот самый серый
-- силуэт. Это не поломка сборщика: у игроков малых лиг фотографии там нет
-- вовсе. Проверено вручную на шести подряд (Óscar Castro, Adrián Peña,
-- Guilherme Viana и других) — у всех `default.jpg`.
--
-- У Soccer Wiki те же люди сфотографированы: из 912 прочитанных страниц
-- портрет есть у 912. Карточек игроков без фото 14 325, из них связаны с
-- источником 6973 — почти половина.
--
-- ⚠️ ТОЛЬКО ТАМ, ГДЕ ФОТО НЕТ. Этот проект уже заменял 165 портретов ревизией
-- и ошибался в первой её версии; перезаписывать снимок, который уже прошёл
-- сверку с Викиданными, нельзя ни при каких числах.
--
-- ⚠️ РИСК ЧУЖОГО ЛИЦА ЗДЕСЬ — ЭТО РИСК СВЯЗЫВАНИЯ, А НЕ ПОИСКА ПО ИМЕНИ.
-- Портрет берётся по `pid` уже связанного игрока, а связывание идёт точным
-- именем В ПРЕДЕЛАХ КЛУБА и отвергает неоднозначные пары. Это на порядок
-- безопаснее, чем искать фото по имени: именно поиск по имени и дал когда-то
-- Кеннеди лицо президента.
create or replace function public.fill_photo_from_soccerwiki()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $function$
declare
  v_filled integer := 0;
begin
  with upd as (
    update cards c set photo_url = p.photo_url
      from soccerwiki_player p
     where p.card_id = c.id
       and c.photo_url is null
       and c.active
       and p.photo_url is not null
       and p.photo_url like 'https://cdn.soccerwiki.org/%'
    returning 1
  )
  select count(*) into v_filled from upd;
  return v_filled;
end;
$function$;

comment on function public.fill_photo_from_soccerwiki() is
  'Портрет с Soccer Wiki карточкам БЕЗ фото. Уже стоящий снимок не трогает.';

revoke all on function public.fill_photo_from_soccerwiki() from public;
grant execute on function public.fill_photo_from_soccerwiki() to service_role;
