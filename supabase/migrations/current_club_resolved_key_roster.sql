-- `resolved_key` не проставлялся у 23 548 строк из 24 807. Вот механизм.
--
-- НАЙДЕНО 07.09.2026, КОГДА СОСТАВ SOCCER WIKI СВЯЗАЛСЯ С КОЛОДОЙ ЛИШЬ НА
-- ЧЕТВЕРТЬ: 12 814 игроков из 49 923. Связывание идёт
-- `card_current_club.resolved_key = soccerwiki_club.club_key`, и оказалось,
-- что у 95% строк `resolved_key` пуст.
--
-- ⚠️ ПРИЧИНА — ОДНА ПРОПУЩЕННАЯ КОЛОНКА В INSERT, А НЕ СОПОСТАВЛЕНИЕ.
-- `fill_current_club_from_roster()` пишет
-- `(card_id, club, club_key, source, fetched_at)` — и `resolved_key` не
-- пишет вовсе. При этом `club_key` там берётся ИЗ САМОГО СПРАВОЧНИКА
-- (`join football_club fc on fc.club_key = c.club_key`), то есть значение,
-- которого не хватало, всё это время лежало в соседней колонке той же строки.
--
-- ⚠️ ЧТО ИМЕННО ЛОМАЛОСЬ, А НЕ «МОГЛО БЫ». По `resolved_key` соединяются
-- ЧЕТЫРЕ разных места: состав Soccer Wiki (`soccerwiki.sql`), связывание
-- ростера с колодой (`roster_card_link.sql`), выбор игроков в фэнтези
-- (`fantasy_options_union.sql`) и переход «игрок → его команда». Пустая
-- колонка не роняет ни одно из них — каждое просто находит меньше, и находит
-- МОЛЧА. Именно так это и жило: экраны работали, числа были правдоподобны.
--
-- Замер до починки: 1259 строк с ключом из 24 807.

-- Шаг 1. Проставить ключ там, где он уже лежит в соседней колонке.
--
-- ⚠️ БЕЗ ВЫЗОВА ФУНКЦИИ НА СТРОКУ. `resolve_club_key` — stable-функция со
-- словарём псевдонимов; вызов её построчно на 24 тысячах строк однажды уже не
-- уложился в минуту и откатил весь прогон (docs/MAP.md,
-- rebuild_football_clubs). Здесь она не нужна вовсе: сверка идёт с
-- справочником напрямую.
update public.card_current_club t
   set resolved_key = t.club_key
  from public.football_club fc
 where t.resolved_key is null
   and fc.club_key = t.club_key;

-- Шаг 2. Остаток — через словарь псевдонимов, ОДИН РАЗ НА НАЗВАНИЕ.
with names as (
  select distinct club from public.card_current_club where resolved_key is null
),
nk as (select club, resolve_club_key(club) as k from names)
update public.card_current_club t
   set resolved_key = nk.k
  from nk
 where nk.club = t.club
   and t.resolved_key is null
   and nk.k is not null;

-- Шаг 3. Починить сам источник, иначе ночной прогон снова наделает пустых.
create or replace function public.fill_current_club_from_roster()
returns table(written integer, ambiguous integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_written integer := 0;
  v_amb     integer := 0;
begin
  create temp table _rc on commit drop as
  select r.card_id, min(r.club_key) as club_key, count(distinct r.club_key) as clubs
    from club_roster r
   where r.card_id is not null
   group by r.card_id;

  select count(*) into v_amb from pg_temp._rc where clubs > 1;

  with src as (
    select c.card_id, c.club_key, coalesce(fc.name, fc.name_en, c.club_key) as club
      from pg_temp._rc c
      join football_club fc on fc.club_key = c.club_key
     where c.clubs = 1
  ),
  ins as (
    -- ⚠️ `resolved_key` — ТА ЖЕ ВЕЛИЧИНА, ЧТО И `club_key`, И ЭТО НЕ
    -- ДУБЛИРОВАНИЕ. `club_key` здесь пришёл из `football_club`, то есть уже
    -- канонический ключ справочника; именно его и ждут четыре соединения по
    -- `resolved_key`. Пропуск этой колонки и был всей поломкой.
    insert into card_current_club (card_id, club, club_key, resolved_key, source, fetched_at)
    select s.card_id, s.club, s.club_key, s.club_key, 'club_roster', now() from src s
    on conflict (card_id) do nothing      -- запись из статьи не трогаем
    returning 1
  )
  select count(*) into v_written from ins;

  drop table pg_temp._rc;
  return query select v_written, v_amb;
end;
$function$;

comment on function public.fill_current_club_from_roster() is
  'Проставляет текущий клуб карточкам, у которых его нет, по заявке клуба '
  '(club_roster). Пишет и resolved_key: по нему соединяются состав Soccer Wiki, '
  'связывание ростера, фэнтези и переход «игрок → его команда».';

revoke all on function public.fill_current_club_from_roster() from public;
grant execute on function public.fill_current_club_from_roster() to service_role;

-- Шаг 4. Ночной ремонт: строка без ключа — это поломка, и чинить её надо там
-- же, где чинят остальное, а не разовой миграцией.
create or replace function public.fill_current_club_resolved_key()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_fixed integer := 0;
  v_more  integer := 0;
begin
  with upd as (
    update card_current_club t set resolved_key = t.club_key
      from football_club fc
     where t.resolved_key is null and fc.club_key = t.club_key
    returning 1
  )
  select count(*) into v_fixed from upd;

  with names as (
    select distinct club from card_current_club where resolved_key is null
  ),
  nk as (select club, resolve_club_key(club) as k from names),
  -- ⚠️ ИМЯ ДРУГОЕ, А НЕ `upd` ВТОРОЙ РАЗ: два CTE с одним именем в одной
  -- функции — синтаксическая ошибка, и ловится она только при применении.
  upd2 as (
    update card_current_club t set resolved_key = nk.k
      from nk
     where nk.club = t.club and t.resolved_key is null and nk.k is not null
    returning 1
  )
  select count(*) into v_more from upd2;

  return v_fixed + v_more;
end;
$function$;

comment on function public.fill_current_club_resolved_key() is
  'Проставляет card_current_club.resolved_key там, где он пуст. Идемпотентна.';

revoke all on function public.fill_current_club_resolved_key() from public;
grant execute on function public.fill_current_club_resolved_key() to service_role;
