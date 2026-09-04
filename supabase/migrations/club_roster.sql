-- ===========================================================================
-- club_roster — ПОЛНЫЙ состав клуба: все игроки, со стоимостью.
--
-- Владелец: «нужны полные составы команды с эмблемами с ESPN со всеми
-- игроками и стоимостью».
--
-- ⚠️ ПОЧЕМУ НЕ В club_squad. У той таблицы `card_id NOT NULL`: это состав в
-- терминах КОЛОДЫ, и по нему считается уровень состава в прогнозах. Полный
-- ростер — это про мир, а не про колоду: у «Реала» 32 игрока, а карточек из
-- них имеет меньше половины. Затолкать их в club_squad можно было бы только
-- заведя тысячи голых карточек — ровно то, из-за чего колода уже портилась
-- («cards_matching начнёт раздавать людей без фотографии»). Поэтому таблицы
-- две, и связь с карточкой здесь НЕОБЯЗАТЕЛЬНА.
--
--     club_squad   что раздаёт игра   card_id NOT NULL
--     club_roster  что говорит мир    card_id NULL допустим
--
-- ⚠️ МОСТ — ИДЕНТИФИКАТОР, А НЕ ПОХОЖЕСТЬ ИМЁН. `football_club.transfermarkt_id`
-- берётся не поиском по названию, а со страницы игрока, чей `transfermarkt_id`
-- у нас уже есть: профиль печатает свой клуб ссылкой `/verein/<id>`. Замер
-- 04.09.2026: Павлович (574671) → «AC Milan» → verein/5. Сопоставление клубов
-- по имени в этом проекте уже связывало «Крузейро» с `cruz azul` и выдавало
-- «Vitória S.C.» герб бразильского EC Vitória.
--
-- ⚠️ ОДИН ЗАПРОС НА КЛУБ, А НЕ НА ИГРОКА. Страница клуба на Transfermarkt
-- отдаёт ВЕСЬ состав со стоимостями сразу: замер на «Реале» (verein/418) —
-- 32 профиля и 35 значений стоимости в одном ответе. Прежний путь стоил по
-- запросу на игрока.
--
-- ⚠️ ИСТОЧНИК НАЗЫВАЕТСЯ ЧЕСТНО. Состав и стоимости принадлежат Transfermarkt,
-- их ToS переиспользование ограничивают, и владелец принял это решение
-- сознательно. Происхождение записано в COMMENT таблицы и названо на экране
-- рядом с числом; маскировать его нельзя.
--
-- ⚠️ ЭМБЛЕМА КЛУБА ОСТАЁТСЯ С ESPN. Она живёт в `football_club.crest_url` и
-- этой таблицей не трогается: у клуба один источник герба, и он ESPN — так
-- решил владелец, и так работает `apply_espn_crests`.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ===========================================================================

alter table football_club add column if not exists transfermarkt_id text;

comment on column football_club.transfermarkt_id is
  'Идентификатор клуба на transfermarkt.com (/verein/<id>). Берётся со '
  'страницы игрока, чей id уже известен, — мост по идентификатору, не по имени.';

alter table football_club drop constraint if exists football_club_tm_id_format;
alter table football_club add  constraint football_club_tm_id_format
  check (transfermarkt_id is null or transfermarkt_id ~ '^[1-9][0-9]*$');

create table if not exists public.club_roster (
  club_key         text    not null,
  tm_player_id     text    not null,
  name             text    not null,
  shirt_number     smallint,
  position         text,
  born_on          date,
  nationality      text,
  -- ⚠️ NULL, а не ноль: у молодых и у завершивших карьеру оценки может не
  -- быть вовсе, и ноль читался бы как «ничего не стоит».
  market_value_eur bigint,
  -- Связь с карточкой колоды — НЕОБЯЗАТЕЛЬНАЯ: в ростере есть люди, которых
  -- в колоде нет и заводить их туда голыми нельзя.
  card_id          uuid references cards(id) on delete set null,
  fetched_at       timestamptz not null default now(),
  primary key (club_key, tm_player_id),
  constraint club_roster_value_positive
    check (market_value_eur is null or market_value_eur > 0)
);

comment on table public.club_roster is
  'ПОЛНЫЙ состав клуба со стоимостью игроков. ИСТОЧНИК — TRANSFERMARKT '
  '(страница клуба /verein/<id>). Отличается от club_squad тем, что не '
  'требует карточки: это состав мира, а не колоды. Эмблема клуба здесь не '
  'хранится — она в football_club.crest_url и приходит с ESPN.';

create index if not exists club_roster_club_idx on club_roster (club_key);
create index if not exists club_roster_card_idx on club_roster (card_id)
  where card_id is not null;

alter table public.club_roster enable row level security;
drop policy if exists club_roster_read on public.club_roster;
create policy club_roster_read on public.club_roster
  for select to anon, authenticated, service_role using (true);

grant select on public.club_roster to anon, authenticated;
-- Конвейер ростер ПЕРЕЗАЛИВАЕТ, поэтому ему мало select. Грант на UPDATE
-- забывали в этом проекте дважды, и отказ был тихим: «75 прочитано, 0
-- записано», оба числа правдоподобны.
grant select, insert, update, delete on public.club_roster to service_role;

-- --------------------------------------------------------------------------
-- Запись состава одного клуба — ОДНОЙ транзакцией и целиком.
--
-- ⚠️ ЗАМЕНА, А НЕ ДОПИСЫВАНИЕ. Ростер — это снимок на дату: игрок, ушедший из
-- клуба, обязан из него ИСЧЕЗНУТЬ, а `on conflict do update` оставил бы его
-- навсегда. Поэтому старые строки клуба удаляются в том же операторе, что
-- вставляются новые.
--
-- ⚠️ ПУСТОЙ СПИСОК НИЧЕГО НЕ УДАЛЯЕТ. Разбор, сломавшийся на смене вёрстки,
-- вернёт ноль игроков — и молча стёр бы состав у всех клубов подряд. Пустота
-- на входе это отказ источника, а не «в клубе никого нет».
-- --------------------------------------------------------------------------
create or replace function public.apply_club_roster(p_club_key text, p_rows jsonb)
returns table (written integer, removed integer)
language plpgsql security definer set search_path = public as $$
declare
  v_written integer := 0;
  v_removed integer := 0;
begin
  if p_club_key is null or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    -- Молчаливое стирание состава — худший исход из возможных.
    return query select 0, 0;
    return;   -- ⚠️ RETURN QUERY только ДОПИСЫВАЕТ строки и из функции не
              -- выходит: без этого код ниже исполнится и состав всё-таки
              -- сотрётся. Та же ловушка записана в карте по
              -- pause_round_on_voice_drop.
  end if;

  -- ⚠️ ДВА ОПЕРАТОРА, А НЕ ДВА data-modifying CTE В ОДНОМ. Postgres не даёт
  -- одному оператору дважды задеть одну версию строки, и второй CTE молча
  -- трогает НОЛЬ строк — этот проект уже чинил так ремонт news_items. Обе
  -- команды идут в одной транзакции функции, так что снимок всё равно один.
  create temp table _roster on commit drop as
  select r->>'tm_player_id'                        as tm_player_id,
         r->>'name'                                as name,
         nullif(r->>'shirt_number','')::smallint   as shirt_number,
         nullif(r->>'position','')                 as position,
         nullif(r->>'born_on','')::date            as born_on,
         nullif(r->>'nationality','')              as nationality,
         nullif(r->>'market_value_eur','')::bigint as market_value_eur
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'tm_player_id','') <> ''
     and coalesce(r->>'name','') <> '';

  delete from club_roster q
   where q.club_key = p_club_key
     and not exists (select 1 from pg_temp._roster t
                      where t.tm_player_id = q.tm_player_id);
  get diagnostics v_removed = row_count;

  -- Карточка находится по transfermarkt_id — тому же идентификатору, а не по
  -- имени. Нет карточки — строка всё равно едет: ростер полный.
  insert into club_roster (club_key, tm_player_id, name, shirt_number,
                           position, born_on, nationality,
                           market_value_eur, card_id, fetched_at)
  select p_club_key, t.tm_player_id, t.name, t.shirt_number, t.position,
         t.born_on, t.nationality, t.market_value_eur, c.id, now()
    from pg_temp._roster t
    left join cards c on c.transfermarkt_id = t.tm_player_id
  on conflict (club_key, tm_player_id) do update set
    name             = excluded.name,
    shirt_number     = excluded.shirt_number,
    position         = excluded.position,
    born_on          = excluded.born_on,
    nationality      = excluded.nationality,
    market_value_eur = excluded.market_value_eur,
    card_id          = coalesce(excluded.card_id, club_roster.card_id),
    fetched_at       = now();
  get diagnostics v_written = row_count;

  drop table pg_temp._roster;
  return query select v_written, v_removed;
end;
$$;

revoke all on function public.apply_club_roster(text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_club_roster(text, jsonb) to service_role;

-- --------------------------------------------------------------------------
-- Чтение экраном: полный состав + сумма + покрытие.
--
-- ⚠️ СУММА ЕДЕТ С ТЕМ, ИЗ СКОЛЬКИХ ОНА СОБРАНА — как и у club_market_value.
-- «€412 млн» по трём игрокам из двадцати восьми не стоимость клуба.
-- --------------------------------------------------------------------------
create or replace function public.club_roster_list(p_club_key text)
-- ⚠️ `player_position`, А НЕ `position`. В списке колонок RETURNS TABLE
-- `position` — зарезервированное слово (POSITION(x IN y)), и функция не
-- создаётся ВОВСЕ: 42601 на строке, где всё написано верно. Третий раз в
-- проекте после club_squad_list и `both` в fantasy_options.
returns table (tm_player_id text, name text, shirt_number smallint,
               player_position text, born_on date, nationality text,
               market_value_eur bigint, card_id uuid, photo_url text,
               fame smallint)
language sql stable security definer set search_path = public as $$
  select r.tm_player_id, r.name, r.shirt_number, r.position, r.born_on,
         r.nationality, r.market_value_eur, r.card_id, c.photo_url, c.fame
    from club_roster r
    left join cards c on c.id = r.card_id
   where r.club_key = p_club_key
   order by r.market_value_eur desc nulls last, r.shirt_number nulls last, r.name;
$$;

grant execute on function public.club_roster_list(text)
  to anon, authenticated, service_role;

create or replace function public.club_roster_value(p_club_key text)
returns table (total_eur bigint, priced integer, squad integer,
               fetched_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(market_value_eur), 0)::bigint,
         count(*) filter (where market_value_eur is not null)::int,
         count(*)::int,
         max(fetched_at)
    from club_roster where club_key = p_club_key;
$$;

grant execute on function public.club_roster_value(text)
  to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
