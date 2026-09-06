-- Soccer Wiki: все клубы мира с составами, по странам и континентам.
--
-- ИСТОЧНИК НАЗВАН ПРЯМО: en.soccerwiki.org, «for the fans, by the fans».
-- Владелец: «ты пропустил самый важный источник данных, фото статистики и
-- характеристики… настрой парсеры на сбор всех команд с составами, разбитых
-- по континентам».
--
-- ЧТО ОН ДАЁТ, ЗАМЕРЕНО 06.09.2026 НА ЖИВЫХ СТРАНИЦАХ:
--   /country.php                    240 стран с трёхбуквенным кодом
--   /country.php?countryId=ENG      182 клуба одной Англии, ссылками на состав
--   /squad.php?clubid=1             состав: номер, имя, позиция, возраст, РЕЙТИНГ
--   /player.php?pid=…               рост, вес, нога, дата рождения, фото
--
-- ⚠️ РЕЙТИНГ И ВОЗРАСТ ПРИХОДЯТ УЖЕ СО СТРАНИЦЫ КЛУБА. Это важно для расхода:
-- полный состав со всеми характеристиками стоит ОДИН запрос на клуб, а не по
-- запросу на игрока. Страница игрока нужна только за ростом, ногой и фото.
--
-- ⚠️ КОНТИНЕНТ НЕ БЕРЁТСЯ ОТСЮДА, ЕГО У ИСТОЧНИКА НЕТ. На /country.php слов
-- «Europe», «Asia», «Oceania» нет вовсе (проверено поиском по странице). У
-- проекта своя карта «страна → континент» — та, что заполняет `cards.continent`.
-- Вторая её копия разошлась бы молча, поэтому здесь хранится только код
-- страны, а группировка по континентам делается существующей картой.
--
-- ⚠️ ЭТО ОТДЕЛЬНЫЕ ТАБЛИЦЫ, А НЕ ЗАПИСЬ ПРЯМО В `cards`. Ровно та же причина,
-- по которой рядом живёт `club_roster`: «что говорит мир» и «что раздаёт игра»
-- разъезжаются, и затирать колоду сырым внешним составом нельзя. Связывание
-- идёт отдельным шагом и по идентификаторам.

create table if not exists public.soccerwiki_club (
  club_id      integer primary key,
  name         text not null,
  country_code text,
  -- Ключ нашего справочника, если клуб сопоставился. NULL — не сопоставился,
  -- и это ответ, а не поломка: у Soccer Wiki есть клубы, которых нет у нас.
  club_key     text,
  fetched_at   timestamptz not null default now()
);

create index if not exists soccerwiki_club_country_idx on public.soccerwiki_club (country_code);
create index if not exists soccerwiki_club_key_idx on public.soccerwiki_club (club_key);

create table if not exists public.soccerwiki_player (
  pid          integer primary key,
  name         text not null,
  club_id      integer references public.soccerwiki_club (club_id) on delete cascade,
  shirt_number integer,
  position     text,
  age          integer,
  -- Рейтинг источника, 1..99. НЕ наш `fame` и не сила в прогнозах: это оценка
  -- редакторов Soccer Wiki, и смешивать её с нашими шкалами нельзя.
  rating       integer,
  card_id      uuid references public.cards (id) on delete set null,
  fetched_at   timestamptz not null default now()
);

create index if not exists soccerwiki_player_club_idx on public.soccerwiki_player (club_id);
create index if not exists soccerwiki_player_card_idx on public.soccerwiki_player (card_id);
create index if not exists soccerwiki_player_name_idx on public.soccerwiki_player (lower(name));

comment on table public.soccerwiki_player is
  'Составы клубов с en.soccerwiki.org: номер, позиция, возраст, рейтинг источника. '
  'Не колода: связь с карточкой — через card_id, отдельным шагом.';

alter table public.soccerwiki_club   enable row level security;
alter table public.soccerwiki_player enable row level security;

-- Читать может кто угодно: это витрина состава на экране клуба.
drop policy if exists soccerwiki_club_read on public.soccerwiki_club;
create policy soccerwiki_club_read on public.soccerwiki_club for select using (true);
drop policy if exists soccerwiki_player_read on public.soccerwiki_player;
create policy soccerwiki_player_read on public.soccerwiki_player for select using (true);

-- Один клуб с его составом — ОДНОЙ транзакцией.
--
-- ⚠️ ПАЧКОЙ, А НЕ ПО СТРОКЕ. Владелец про запись уже говорил прямо: «Любая
-- пачка применяется одной транзакцией или идемпотентна целиком». Полсотни
-- PATCH-ей на клуб — это полсотни шансов оборваться на середине состава.
create or replace function public.apply_soccerwiki_squad(
  p_club_id integer,
  p_name    text,
  p_country text,
  p_rows    jsonb)
returns table(players integer, linked integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_players integer := 0;
  v_linked  integer := 0;
begin
  insert into soccerwiki_club (club_id, name, country_code, club_key, fetched_at)
  values (p_club_id, p_name, nullif(p_country, ''),
          -- Сопоставляет `resolve_club_key` — словарь псевдонимов у базы, и
          -- второй его копии в питоне заводить нельзя.
          (select fc.club_key from football_club fc
            where fc.club_key = resolve_club_key(p_name, null)),
          now())
  on conflict (club_id) do update
     set name = excluded.name,
         country_code = excluded.country_code,
         club_key = excluded.club_key,
         fetched_at = now();

  with raw as (
    select (r->>'pid')::integer          as pid,
           btrim(r->>'name')             as name,
           nullif(r->>'shirt_number','')::integer as shirt_number,
           nullif(btrim(r->>'position'),'')       as position,
           nullif(r->>'age','')::integer          as age,
           nullif(r->>'rating','')::integer       as rating,
           ord
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, ord)
     where coalesce(r->>'pid','') <> '' and coalesce(btrim(r->>'name'),'') <> ''
  ),
  rows as (
    -- ⚠️ ОДИН ИГРОК — ОДНА СТРОКА В ПАЧКЕ, И ЭТО НЕ ПРИДИРКА: страница клуба
    -- перечисляет игрока дважды (таблица состава и схема на поле), и без
    -- этого `on conflict do update` падает «cannot affect row a second time»
    -- — причём ВСЕЙ пачкой, то есть клуб не записывается вовсе. Поймано на
    -- первом же живом прогоне по Англии.
    select distinct on (pid) pid, name, shirt_number, position, age, rating
      from raw order by pid, ord
  ),
  ins as (
    insert into soccerwiki_player
      (pid, name, club_id, shirt_number, position, age, rating, fetched_at)
    select pid, name, p_club_id, shirt_number, position, age, rating, now()
      from rows
    on conflict (pid) do update
       set name = excluded.name, club_id = excluded.club_id,
           shirt_number = excluded.shirt_number, position = excluded.position,
           age = excluded.age, rating = excluded.rating, fetched_at = now()
    returning 1
  )
  select (select count(*) from ins) into v_players;

  -- Связывание с колодой — ТОЧНОЕ ИМЯ В ПРЕДЕЛАХ КЛУБА, как у ростера.
  -- Неоднозначная пара не берётся: `name_en` не уникален по человеку, и в
  -- этом проекте уже записано, что «Родри» — две разные активные карточки.
  with cand as (
    select p.pid, c.id as card_id
      from soccerwiki_player p
      join soccerwiki_club sc on sc.club_id = p.club_id
      join card_current_club cc on cc.resolved_key = sc.club_key
      join cards c on c.id = cc.card_id
     where p.club_id = p_club_id
       and p.card_id is null
       and c.active and c.name_en is not null
       and lower(btrim(c.name_en)) = lower(btrim(p.name))
  ),
  clean as (
    select d.* from cand d
     where 1 = (select count(*) from cand x where x.pid = d.pid)
       and 1 = (select count(*) from cand y where y.card_id = d.card_id)
  ),
  upd as (
    update soccerwiki_player p set card_id = k.card_id
      from clean k where p.pid = k.pid and p.card_id is null
    returning 1
  )
  select (select count(*) from upd) into v_linked;

  return query select v_players, v_linked;
end;
$function$;

comment on function public.apply_soccerwiki_squad(integer, text, text, jsonb) is
  'Клуб Soccer Wiki с составом, одной транзакцией. Связывает игроков с колодой '
  'точным именем в пределах клуба; неоднозначные не связывает.';

revoke all on function public.apply_soccerwiki_squad(integer, text, text, jsonb) from public;
grant execute on function public.apply_soccerwiki_squad(integer, text, text, jsonb) to service_role;
