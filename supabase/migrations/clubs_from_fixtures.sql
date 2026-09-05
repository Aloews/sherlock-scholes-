-- Команда из расписания, которой нет в справочнике, ЗАВОДИТСЯ.
--
-- ЧЕГО НЕ БЫЛО. `rebuild_football_clubs()` собирает справочник ИЗ КАРТОЧЕК и
-- из истории матчей игроков. Команда, которая есть только в расписании —
-- поднявшаяся в лигу, попавшая в новый турнир, — не появлялась НИКОГДА: ни
-- эмблемы, ни состава, ни стоимости, потому что не было самой строки.
--
-- ⚠️ ВЕНТИЛЬ ЗДЕСЬ СНАЧАЛА БЫЛ НЕВЕРЕН, И ПОЙМАЛ ЭТО КОНТРОЛЬ, А НЕ ЧТЕНИЕ.
-- Стояло `resolve_club_key(team) is null`. Но резолвер ТОТАЛЬНЫЙ: он
-- нормализует любое имя, существует такой клуб или нет («Zzzcontrol Wanderers
-- FC» → `zzzcontrol wanderers`). Условие не срабатывало НИКОГДА, функция была
-- мёртвым кодом и уверенно возвращала ноль. Признак незнакомой команды —
-- ОТСУТСТВИЕ СТРОКИ СПРАВОЧНИКА под её ключом.
--
-- Это же уточняет и замер. «В расписании 437 команд, и все 437 разрешаются» —
-- утверждение ни о чём: разрешается что угодно. Верное: у всех 437 ключей
-- ЕСТЬ строка справочника, поэтому сегодня функция заводит НОЛЬ клубов — и
-- это правильный ответ, а не бездействие.
--
-- ⚠️ ПРОВЕРЕНО ПОДСТАВНЫМ МАТЧЕМ, а не рассуждением: с командой, которой нет,
-- функция даёт added=1, seen=1; без неё — 0/0. Подставные строки убраны, в
-- справочнике те же 1545 клубов.
--
-- ⚠️ ПОЧЕМУ УБОРЩИК ИХ НЕ СНЕСЁТ. `prune_orphan_clubs()` удаляет строку без
-- карточки, без истории и без состава — НО оставляет ту, на которую указывает
-- расписание (`_fixture_keys`). Заведённый отсюда клуб под это исключение
-- попадает по построению: его имя пришло из расписания, и `resolve_club_key`
-- теперь сводит это имя к нему.
--
-- ⚠️ ИМЯ ЛАТИНИЦЕЙ — ЭТО ЧЕСТНО, А НЕ НЕБРЕЖНО. Русского названия у нас для
-- такого клуба нет, и выдумывать транслитерацию нельзя: она не сходится
-- обратно («Аль-Айн» → `al ayn` против ESPN `al ain`, замер в шапке
-- clubs_crests_espn.py). `name_en` при этом заполняется ВЕРНО, а он и нужен
-- дальше по цепочке — и эмблеме ESPN, и мосту на Transfermarkt.

create or replace function public.add_clubs_from_fixtures()
returns table(added integer, seen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_added integer := 0;
  v_seen  integer := 0;
begin
  create temp table _new on commit drop as
  select distinct btrim(t.team) as team, resolve_club_key(t.team, null) as club_key
    from (select home_team as team from fixtures
          union all
          select away_team from fixtures) t
   where t.team is not null
     and length(btrim(t.team)) >= 3          -- «FC» отдельной строкой не клуб
     and resolve_club_key(t.team, null) is not null
     and not exists (select 1 from football_club fc
                      where fc.club_key = resolve_club_key(t.team, null));

  select count(*) into v_seen from pg_temp._new;

  with one as (
    -- Два разных написания, сводящихся к одному ключу, — не два клуба.
    select distinct on (n.club_key) n.club_key, n.team
      from pg_temp._new n
     where btrim(n.club_key) <> ''
     order by n.club_key, n.team
  ),
  ins as (
    insert into football_club (club_key, name, name_en, kind, fetched_at)
    select o.club_key, o.team, o.team, 'club', now() from one o
    on conflict (club_key) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  drop table pg_temp._new;
  return query select v_added, v_seen;
end;
$function$;

comment on function public.add_clubs_from_fixtures() is
  'Заводит клуб по команде из расписания, которой нет в справочнике. '
  'Признак — отсутствие строки под её ключом: resolve_club_key тотальный и '
  'null не возвращает.';

revoke all on function public.add_clubs_from_fixtures() from public;
grant execute on function public.add_clubs_from_fixtures() to service_role;

-- 04:50 — ПЕРЕД ночным обогащением (05:00 UTC, daily-enrich.yml), чтобы новый
-- клуб в ту же ночь получил эмблему, мост и состав, а не сутками позже.
select cron.schedule(
  'add-clubs-from-fixtures',
  '50 4 * * *',
  $$select public.add_clubs_from_fixtures()$$
);
