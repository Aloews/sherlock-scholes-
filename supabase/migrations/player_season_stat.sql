-- ===========================================================================
-- СТАТИСТИКА ПО СЕЗОНАМ — по просьбе владельца «проверь статистику и историю
-- трансферов у Классена и игроков его ценовой категории и выше».
--
-- ЧТО БЫЛО НЕ ТАК. Статистика в карточке бралась из инфобокса Википедии
-- (`cards.career_stats`, сборщик docs/cards_career_build.py). Замер по
-- категории €600 тыс.+ (8986 карточек): career_stats есть у 1147. Это не
-- недоработка сборщика — у 98% футболистов мира нет статьи ни на одном языке,
-- ровно та же причина, по которой они и в колоду не попадали.
--
-- Хуже, что там, где Википедия ЕСТЬ, она врёт умолчанием. Классен, карточка
-- которую владелец прислал скриншотом: инфобокс дал 4 клуба (верхние по
-- матчам), а на деле их семь. Пропали «ВСГ Тироль», где он отыграл лучший
-- свой сезон (37 матчей, 3144 минуты), «Дармштадт» и нынешний «Грацер».
-- Карточка выглядела заполненной и была неполной — это худший вид пустоты.
--
-- ОТКУДА БЕРЁМ ТЕПЕРЬ. Источник назван прямо: transfermarkt.com, его
-- публичный JSON `tmapi.transfermarkt.technology/player/<id>/performance-competition`.
-- Один запрос на игрока отдаёт КАЖДЫЙ сезон в КАЖДОМ турнире за КАЖДЫЙ клуб:
-- матчи, в старте, минуты, голы, передачи, карточки. У Классена — 19 строк
-- вместо четырёх, включая юношеские сборные.
--
-- ⚠️ КЛЮЧ — (игрок, сезон, турнир, клуб), И КЛУБ В КЛЮЧЕ ОБЯЗАТЕЛЕН. Сезон
-- 2021 Классен начал в «Тироле», а закончил в «Спартаке»; без клуба в ключе
-- одна из двух строк затёрла бы другую, и год просто исчез бы из карьеры.
--
-- ⚠️ СБОРНАЯ ЛЕЖИТ ЗДЕСЬ ЖЕ, но отделена ЧЕСТНЫМ ПРИЗНАКОМ ИСТОЧНИКА
-- (`tm_club.is_national_team`), а не догадкой по составу. Раньше сборные
-- приходилось узнавать по поведению — «доля игроков без другого клуба»; у
-- источника это поле есть, и гадать больше не нужно. Сложить 5 матчей за
-- сборную России до 17 в клубную карьеру значило бы соврать в сумме.
-- ===========================================================================

create table if not exists public.player_season_stat (
  tm_player_id   text     not null,
  season_id      smallint not null,
  competition_id text     not null,
  club_id        text     not null,
  card_id        uuid,
  apps           smallint not null default 0,
  starts         smallint not null default 0,
  sub_in         smallint not null default 0,
  sub_out        smallint not null default 0,
  minutes        integer  not null default 0,
  goals          smallint not null default 0,
  assists        smallint not null default 0,
  own_goals      smallint not null default 0,
  penalty_goals  smallint not null default 0,
  yellow         smallint not null default 0,
  yellow_red     smallint not null default 0,
  red            smallint not null default 0,
  team_goals     smallint not null default 0,
  opponent_goals smallint not null default 0,
  fetched_at     timestamptz not null default now(),
  primary key (tm_player_id, season_id, competition_id, club_id)
);

create index if not exists player_season_stat_card_idx
  on public.player_season_stat (card_id, season_id desc);

-- Справочник турниров: без него в карточке стояли бы коды «A1», «RUP», «DKAR».
create table if not exists public.tm_competition (
  id           text primary key,
  name         text,
  short_name   text,
  country_id   integer,
  type_id      integer,
  logo_url     text,
  updated_at   timestamptz not null default now()
);

-- Справочник клубов из того же источника. `is_national_team` — ПОЛЕ ИСТОЧНИКА,
-- не наша догадка; на нём держится разделение клубной карьеры и сборной.
create table if not exists public.tm_club (
  id               text primary key,
  name             text,
  country_id       integer,
  is_national_team boolean not null default false,
  updated_at       timestamptz not null default now()
);

alter table public.player_season_stat enable row level security;
alter table public.tm_competition      enable row level security;
alter table public.tm_club             enable row level security;

drop policy if exists player_season_stat_read on public.player_season_stat;
create policy player_season_stat_read on public.player_season_stat for select using (true);
drop policy if exists tm_competition_read on public.tm_competition;
create policy tm_competition_read on public.tm_competition for select using (true);
drop policy if exists tm_club_read on public.tm_club;
create policy tm_club_read on public.tm_club for select using (true);

-- Гранты перечислены ЯВНО: политика без гранта роняла этот проект — чтение
-- разрешено, а роль всё равно получает 403 «permission denied for table».
grant select on public.player_season_stat, public.tm_competition, public.tm_club
  to anon, authenticated;
grant all on public.player_season_stat, public.tm_competition, public.tm_club
  to service_role;

-- --------------------------------------------------------------------------
-- Запись пачкой: один игрок — одна транзакция, целиком идемпотентная.
-- distinct on (сезон, турнир, клуб) не формальность: без него повтор ключа
-- внутри пачки даёт «on conflict do update cannot affect row a second time».
-- --------------------------------------------------------------------------
create or replace function public.apply_player_season_stats(p_tm_id text, p_rows jsonb)
returns table (written integer, linked integer)
language plpgsql security definer set search_path = public as $$
declare
  v_written integer := 0;
  v_card    uuid;
begin
  select id into v_card from cards
   where transfermarkt_id = p_tm_id and active and category = 'player' limit 1;

  with src as (
    select distinct on (r->>'season_id', r->>'competition_id', r->>'club_id')
           (r->>'season_id')::smallint      as season_id,
           r->>'competition_id'             as competition_id,
           r->>'club_id'                    as club_id,
           coalesce((r->>'apps')::smallint, 0)           as apps,
           coalesce((r->>'starts')::smallint, 0)         as starts,
           coalesce((r->>'sub_in')::smallint, 0)         as sub_in,
           coalesce((r->>'sub_out')::smallint, 0)        as sub_out,
           coalesce((r->>'minutes')::integer, 0)         as minutes,
           coalesce((r->>'goals')::smallint, 0)          as goals,
           coalesce((r->>'assists')::smallint, 0)        as assists,
           coalesce((r->>'own_goals')::smallint, 0)      as own_goals,
           coalesce((r->>'penalty_goals')::smallint, 0)  as penalty_goals,
           coalesce((r->>'yellow')::smallint, 0)         as yellow,
           coalesce((r->>'yellow_red')::smallint, 0)     as yellow_red,
           coalesce((r->>'red')::smallint, 0)            as red,
           coalesce((r->>'team_goals')::smallint, 0)     as team_goals,
           coalesce((r->>'opponent_goals')::smallint, 0) as opponent_goals
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'season_id','') <> ''
       and coalesce(r->>'competition_id','') <> ''
       and coalesce(r->>'club_id','') <> ''
     order by r->>'season_id', r->>'competition_id', r->>'club_id'
  ),
  ins as (
    insert into player_season_stat (
      tm_player_id, season_id, competition_id, club_id, card_id,
      apps, starts, sub_in, sub_out, minutes, goals, assists, own_goals,
      penalty_goals, yellow, yellow_red, red, team_goals, opponent_goals, fetched_at)
    select p_tm_id, season_id, competition_id, club_id, v_card,
           apps, starts, sub_in, sub_out, minutes, goals, assists, own_goals,
           penalty_goals, yellow, yellow_red, red, team_goals, opponent_goals, now()
      from src
    on conflict (tm_player_id, season_id, competition_id, club_id) do update
       set card_id = excluded.card_id, apps = excluded.apps, starts = excluded.starts,
           sub_in = excluded.sub_in, sub_out = excluded.sub_out,
           minutes = excluded.minutes, goals = excluded.goals,
           assists = excluded.assists, own_goals = excluded.own_goals,
           penalty_goals = excluded.penalty_goals, yellow = excluded.yellow,
           yellow_red = excluded.yellow_red, red = excluded.red,
           team_goals = excluded.team_goals, opponent_goals = excluded.opponent_goals,
           fetched_at = now()
    returning 1
  )
  select count(*) into v_written from ins;

  return query select v_written, (case when v_card is null then 0 else 1 end);
end;
$$;

revoke all on function public.apply_player_season_stats(text, jsonb) from public;
grant execute on function public.apply_player_season_stats(text, jsonb) to service_role;

-- Справочники: пачкой, целиком идемпотентно.
create or replace function public.apply_tm_directory(p_clubs jsonb, p_competitions jsonb)
returns table (clubs integer, competitions integer)
language plpgsql security definer set search_path = public as $$
declare v_c integer := 0; v_k integer := 0;
begin
  with src as (
    select distinct on (r->>'id') r->>'id' as id, nullif(r->>'name','') as name,
           nullif(r->>'country_id','')::integer as country_id,
           coalesce((r->>'is_national_team')::boolean, false) as nat
      from jsonb_array_elements(coalesce(p_clubs, '[]'::jsonb)) r
     where coalesce(r->>'id','') <> '' order by r->>'id'
  ), ins as (
    insert into tm_club (id, name, country_id, is_national_team, updated_at)
    select id, name, country_id, nat, now() from src
    on conflict (id) do update set name = excluded.name,
      country_id = excluded.country_id, is_national_team = excluded.is_national_team,
      updated_at = now()
    returning 1
  ) select count(*) into v_c from ins;

  with src as (
    select distinct on (r->>'id') r->>'id' as id, nullif(r->>'name','') as name,
           nullif(r->>'short_name','') as short_name,
           nullif(r->>'country_id','')::integer as country_id,
           nullif(r->>'type_id','')::integer as type_id,
           nullif(r->>'logo_url','') as logo_url
      from jsonb_array_elements(coalesce(p_competitions, '[]'::jsonb)) r
     where coalesce(r->>'id','') <> '' order by r->>'id'
  ), ins as (
    insert into tm_competition (id, name, short_name, country_id, type_id, logo_url, updated_at)
    select id, name, short_name, country_id, type_id, logo_url, now() from src
    on conflict (id) do update set name = excluded.name,
      short_name = excluded.short_name, country_id = excluded.country_id,
      type_id = excluded.type_id, logo_url = excluded.logo_url, updated_at = now()
    returning 1
  ) select count(*) into v_k from ins;

  return query select v_c, v_k;
end;
$$;

revoke all on function public.apply_tm_directory(jsonb, jsonb) from public;
grant execute on function public.apply_tm_directory(jsonb, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- ЧТЕНИЕ ДЛЯ КАРТОЧКИ: клубная карьера, от последнего клуба к первому.
--
-- Владелец: «сортировку клубной карьеры нужно изменить, не по количеству
-- проведенных матчей, а по годам, от последнего клуба к первому». Здесь это
-- уже не разбор строки «2022–», а число сезона из источника.
--
-- ⚠️ СБОРНЫЕ ИСКЛЮЧЕНЫ — по флагу источника, а не по имени. Иначе «Россия
-- U17» встала бы в клубную карьеру наравне со «Спартаком».
-- ⚠️ ОДИН КЛУБ — ОДНА СТРОКА, турниры внутри сложены: игрок за сезон играет
-- и в лиге, и в кубке, и в еврокубке. Показывать их порознь значит показать
-- «Спартак» трижды подряд.
-- --------------------------------------------------------------------------
create or replace function public.player_club_career(p_card_id uuid)
returns table (
  club_id     text,
  club_name   text,
  season_from smallint,
  season_to   smallint,
  apps        integer,
  goals       integer,
  assists     integer,
  minutes     bigint
)
language sql stable security definer set search_path = public as $$
  select s.club_id,
         coalesce(k.name, s.club_id),
         min(s.season_id), max(s.season_id),
         sum(s.apps)::integer, sum(s.goals)::integer,
         sum(s.assists)::integer, sum(s.minutes)::bigint
    from player_season_stat s
    left join tm_club k on k.id = s.club_id
   where s.card_id = p_card_id
     and not coalesce(k.is_national_team, false)
   group by s.club_id, coalesce(k.name, s.club_id)
   -- От последнего клуба к первому: сперва по последнему сезону, а при
   -- совпадении — по первому, иначе два клуба одного года встают случайно.
   order by max(s.season_id) desc, min(s.season_id) desc, sum(s.apps) desc;
$$;

revoke all on function public.player_club_career(uuid) from public;
grant execute on function public.player_club_career(uuid) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Итоги карьеры одной строкой — то самое число, которое показывает карточка.
-- Клубы и сборная РАЗДЕЛЕНЫ: сложить их в одну сумму значит соврать.
--
-- ⚠️ DROP ПЕРЕД CREATE: набор OUT-колонок менялся дважды, а `create or
-- replace` этого не умеет.
-- --------------------------------------------------------------------------
drop function if exists public.player_career_totals(uuid);

create or replace function public.player_career_totals(p_card_id uuid)
returns table (
  club_apps        integer,
  club_goals       integer,
  club_assists     integer,
  club_minutes     bigint,
  club_count       integer,
  season_from      smallint,
  season_to        smallint,
  national_apps    integer,
  national_goals   integer,
  national_team    text,
  leagues          integer,
  countries        integer
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select s.*, coalesce(k.is_national_team, false) as nat, k.name as club_name,
           t.type_id, t.country_id
      from player_season_stat s
      left join tm_club k on k.id = s.club_id
      left join tm_competition t on t.id = s.competition_id
     where s.card_id = p_card_id
  ),
  -- ⚠️ СБОРНАЯ ОДНА, А НЕ ВСЕ СРАЗУ, И ЭТО ИСПРАВЛЕННАЯ ОШИБКА. Сперва тут
  -- складывались матчи за ВСЕ сборные игрока, и Криштиану Роналду получал 259
  -- матчей за Португалию: 246 за главную плюс 7 за U21, 4 за U17 и 2 за
  -- олимпийскую. Подпись называет одну команду — значит и число обязано быть
  -- её. Главной считается та, за которую сыграно больше всего.
  team as (
    select r.club_name, sum(r.apps)::integer as apps, sum(r.goals)::integer as goals
      from rows r where r.nat and r.club_name is not null
     group by r.club_name order by sum(r.apps) desc limit 1
  )
  select coalesce(sum(apps) filter (where not nat), 0)::integer,
         coalesce(sum(goals) filter (where not nat), 0)::integer,
         coalesce(sum(assists) filter (where not nat), 0)::integer,
         coalesce(sum(minutes) filter (where not nat), 0)::bigint,
         count(distinct club_id) filter (where not nat)::integer,
         min(season_id), max(season_id),
         coalesce((select apps from team), 0),
         coalesce((select goals from team), 0),
         (select club_name from team),
         -- ⚠️ ЛИГА — ЭТО ДИВИЗИОН, А НЕ ЛЮБОЙ ТУРНИР. `type_id` источника
         -- разделяет их честно: 1..6 — дивизионы страны от высшего вниз,
         -- 7 — юношеские, 8 — кубок, 9 — суперкубок, 12 — стыковые. Считать
         -- кубок лигой значило бы объявить «играл в трёх лигах» человеку,
         -- отыгравшему один сезон в одном клубе: лига, кубок и суперкубок.
         count(distinct competition_id) filter (
           where not nat and type_id between 1 and 6)::integer,
         count(distinct country_id) filter (
           where not nat and country_id is not null and country_id > 0)::integer
    from rows;
$$;

revoke all on function public.player_career_totals(uuid) from public;
grant execute on function public.player_career_totals(uuid) to anon, authenticated, service_role;
