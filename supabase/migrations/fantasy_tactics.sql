-- ============================================================================
-- SHERLOCK SCHOLES — ТАКТИКА в фэнтези: позиция карточки начинает значить.
--
-- ЧТО ЭТО ЧИНИТ. docs/FANTASY_AND_MINIGAMES.md §4 называет слабость пути A
-- прямым текстом: «все игроки одного клуба получают одинаково. Вратарь и
-- нападающий „Барселоны" неразличимы. Смягчается позицией из cards.position
-- (сухарь ценнее защитникам, голы — нападающим)». Это и есть то смягчение.
--
-- Из-за этого состав собирался по одному признаку — у чьего клуба матч полегче,
-- — и пятёрка из пяти нападающих «Барселоны» была ровно так же хороша, как
-- любая другая пятёрка тех же клубов. Выбор был, решения не было.
--
-- ЗАМЕР, НА КОТОРОМ ЭТО СТОИТ. Позиция лежит в `cards.facts->>'position'` и
-- принимает РОВНО ЧЕТЫРЕ значения — не свободный текст, проверено запросом по
-- боевой базе 24.08.2026:
--
--   Полузащитник 989   Защитник 785   Нападающий 632   Вратарь 259
--
-- В ближайшем открытом туре: 742 карточки из 787 с позицией (94%), из них
-- 65 вратарей, 231 защитник, 271 полузащитник, 175 нападающих. То есть любая
-- из трёх схем ниже собирается, а не остаётся нарисованной кнопкой.
--
-- ⚠️ 45 КАРТОЧЕК БЕЗ ПОЗИЦИИ — И ОНИ НЕ ШТРАФУЮТСЯ. Позиция приходит из
-- обогащения, её отсутствие — свойство наших данных, а не игрока. Такая
-- карточка считается по СТАРОМУ правилу (`fantasy_match_points`, сухарь +2,
-- гол +1) и не идёт в зачёт требований схемы. Это честный ответ «мы не знаем»:
-- старое правило и есть правило, не знающее позиции.
--
-- ⚠️ ОЧКИ ТЕПЕРЬ ЗАВИСЯТ ОТ ТОГО, КТО ВЫБРАЛ КАРТОЧКУ. Раньше карточка стоила
-- одинаково всем, и `fantasy_card_points(round)` (карточка → очки) этого
-- хватало. Теперь та же карточка приносит разное двум менеджерам с разными
-- схемами, поэтому появился `fantasy_pick_points(round)` — (игрок, карточка) →
-- очки. Старая функция ОСТАВЛЕНА и не тронута: она по-прежнему верна как
-- ответ «сколько это стоит без позиции и без схемы».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Позиция карточки → короткий ключ. Русский текст из обогащения не растекается
-- дальше этой функции: сравнивать в четырёх местах строку «Полузащитник» —
-- значит однажды сравнить её с «полузащитник».
--
-- NULL для всего остального, включая карточки без позиции. Гадать тут нечего:
-- четыре значения выше — это ВЕСЬ словарь, а не самые частые из длинного
-- хвоста.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_position_key(p_position text)
returns text language sql immutable as $$
  select case btrim(coalesce(p_position, ''))
           when 'Вратарь'      then 'gk'
           when 'Защитник'     then 'def'
           when 'Полузащитник' then 'mid'
           when 'Нападающий'   then 'fwd'
           else null
         end
$$;

-- ---------------------------------------------------------------------------
-- Сколько позиции стоит сухарь и сколько — каждый гол клуба.
--
-- Числа подобраны так, чтобы одна и та же победа 2:0 стоила сопоставимо
-- игрокам разных линий, а не превращала одну линию в единственно верную:
--
--            сухарь   гол    2:0     1:1     0:0     3:1
--   вратарь     4       0      7       1       5       3
--   защитник    4       1      9       2       5       6
--   полуз.      1       1      6       2       2       6
--   нападающий  0       2      7       3       1       9
--
-- Разброс есть, доминирующей линии нет: вратарь и защитник живут сухарями,
-- нападающий — голами, полузащитник ровно посередине и потому скучен в
-- крайностях и надёжен в середине.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_clean_sheet_points(p_pos_key text)
returns integer language sql immutable as $$
  select case p_pos_key when 'gk' then 4 when 'def' then 4 when 'mid' then 1
                        when 'fwd' then 0 else 0 end
$$;

create or replace function public.fantasy_goal_points(p_pos_key text)
returns integer language sql immutable as $$
  select case p_pos_key when 'gk' then 0 when 'def' then 1 when 'mid' then 1
                        when 'fwd' then 2 else 0 end
$$;

-- ---------------------------------------------------------------------------
-- Схемы. Три, и каждая — СТАВКА, а не украшение.
--
--   Оборона  сухарь ×2, голы ×0   требует ≥3 карточек вратарь/защитник
--   Баланс   сухарь ×1, голы ×1   требований нет
--   Атака    сухарь ×0, голы ×2   требует ≥2 нападающих
--
-- ПОЧЕМУ КРАЙНОСТИ, А НЕ ПОЛУТОНА. Вес 0 — это и есть цена: «Оборона» с
-- пропущенным голом не получает за голы своего клуба НИЧЕГО, «Атака» при 0:0
-- не получает ничего за сухарь. Смягчить веса до 1.5 и 0.5 значило бы сделать
-- выбор почти бесплатным, а бесплатный выбор перестают делать.
--
-- «Баланс» при этом не худший вариант, а страховка: он единственный, кто
-- получает что-то в любом исходе. Проверено на 3:1 в таблице выше — там
-- «Баланс» обгоняет «Оборону» у того же защитника (6 против 3).
--
-- Требование к составу — вторая половина ставки: под «Оборону» приходится
-- РЕАЛЬНО собрать оборону, которая потом окажется бесполезной, если сухарей
-- не будет. Без требования схема была бы переключателем множителя, а не
-- тактикой.
-- ---------------------------------------------------------------------------
create table if not exists public.fantasy_tactic (
  key            text primary key,
  clean_sheet_x  smallint not null,
  goal_x         smallint not null,
  -- Сколько карточек каких линий обязано быть в пятёрке. NULL — без требования.
  min_defence    smallint,   -- вратарь + защитник
  min_forwards   smallint,
  sort_order     smallint not null
);

insert into public.fantasy_tactic (key, clean_sheet_x, goal_x, min_defence, min_forwards, sort_order)
values
  ('defensive', 2, 0, 3,    null, 1),
  ('balanced',  1, 1, null, null, 2),
  ('attacking', 0, 2, null, 2,    3)
on conflict (key) do update set
  clean_sheet_x = excluded.clean_sheet_x,
  goal_x        = excluded.goal_x,
  min_defence   = excluded.min_defence,
  min_forwards  = excluded.min_forwards,
  sort_order    = excluded.sort_order;

comment on table public.fantasy_tactic is
  'Схемы фэнтези: веса на сухарь и голы плюс требование к составу. Таблица, а '
  'не CASE в функции — правило показывается игроку на экране, и второй его '
  'копии в TypeScript быть не должно.';

-- Схема, выбранная менеджером на тур. Отдельная таблица, а не колонка в
-- fantasy_pick: схема одна на состав, а pick — строка на карточку, и пять
-- копий одного значения рано или поздно разъедутся.
create table if not exists public.fantasy_squad_tactic (
  round_id   bigint not null references public.fantasy_round(id) on delete cascade,
  player_id  bigint not null references public.players(id)       on delete cascade,
  tactic     text   not null references public.fantasy_tactic(key),
  created_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

alter table public.fantasy_tactic       enable row level security;
alter table public.fantasy_squad_tactic enable row level security;
revoke all on public.fantasy_tactic       from public, anon, authenticated;
revoke all on public.fantasy_squad_tactic from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Очки за один матч клуба — с позицией и схемой.
--
-- База (победа/ничья/крупное поражение) НЕ зависит ни от того, ни от другого:
-- результат клуба одинаков для всех одиннадцати, и делить его по линиям
-- значило бы выдумать факт. Схема и позиция двигают только две надбавки.
--
-- Карточка без позиции идёт мимо этой функции целиком — см. шапку файла.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_tactic_points(
  p_scored smallint, p_conceded smallint, p_pos_key text, p_tactic text
) returns integer
language sql stable security definer set search_path = public as $$
  select case when p_pos_key is null then fantasy_match_points(p_scored, p_conceded)
              else (
                -- База: результат клуба, одинаковый для всех линий.
                case when p_scored > p_conceded then 3
                     when p_scored = p_conceded then 1
                     else 0 end
                + case when p_conceded - p_scored >= 3 then -1 else 0 end
                -- Надбавки: их и двигает схема.
                + case when p_conceded = 0
                       then fantasy_clean_sheet_points(p_pos_key) * t.clean_sheet_x
                       else 0 end
                + coalesce(p_scored, 0) * fantasy_goal_points(p_pos_key) * t.goal_x
              )
         end
    from fantasy_tactic t
   where t.key = coalesce(p_tactic, 'balanced');
$$;

-- ---------------------------------------------------------------------------
-- Очки каждой ЗАЯВКИ за тур: (игрок, карточка) → очки.
--
-- Не (карточка → очки), как fantasy_card_points: одна и та же карточка теперь
-- приносит разное двум менеджерам, потому что схема у них разная. Капитан
-- здесь НЕ удваивается — он удваивается там же, где и раньше, при чтении, и
-- по той же причине: удвоенное в хранилище значение переписало бы историю при
-- смене капитана.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_pick_points(p_round_id bigint)
returns table (player_id bigint, card_id uuid, points integer, matches integer)
language sql stable security definer set search_path = public as $$
  with r as (select fr.starts_at, fr.ends_at from fantasy_round fr where fr.id = p_round_id),
  played as (
    select cc.card_id,
           case when cc.club_key = club_match_key(f.home_team) then f.home_score else f.away_score end as scored,
           case when cc.club_key = club_match_key(f.home_team) then f.away_score else f.home_score end as conceded
      from card_current_club cc
      join fixtures f on cc.club_key in (club_match_key(f.home_team), club_match_key(f.away_team))
      cross join r
     where f.completed and f.home_score is not null and f.away_score is not null
       and f.commence_at >= r.starts_at and f.commence_at < r.ends_at
  )
  select p.player_id,
         p.card_id,
         coalesce(sum(fantasy_tactic_points(
           pl.scored, pl.conceded,
           fantasy_position_key(c.facts->>'position'),
           coalesce(st.tactic, 'balanced')
         )), 0)::int,
         count(pl.card_id)::int
    from fantasy_pick p
    join cards c on c.id = p.card_id
    left join fantasy_squad_tactic st
           on st.round_id = p.round_id and st.player_id = p.player_id
    left join played pl on pl.card_id = p.card_id
   where p.round_id = p_round_id
   group by p.player_id, p.card_id;
$$;

-- ---------------------------------------------------------------------------
-- Подходит ли пятёрка под схему. Отдельной функцией, потому что спрашивают её
-- дважды: сервер — при записи, экран — до неё, чтобы кнопка отказывала
-- ПОНЯТНО, а не молча возвращала false.
--
-- ⚠️ НЕЗНАКОМАЯ СХЕМА ОТВЕЧАЕТ `false`, А НЕ NULL, И ЭТО НЕ ПРИДИРКА. В первой
-- версии `where t.key = ...` просто не находил строки, функция возвращала NULL
-- — и в plpgsql `if not fantasy_tactic_fits(...) then return false` при NULL
-- НЕ СРАБАТЫВАЕТ: `not null` это null, а null в `if` идёт по ветке «ложь», то
-- есть проверка молча пропускала состав. Поймано тестом (случай D,
-- supabase/tests/fantasy_tactics.test.sql), в прод в таком виде не уехало.
-- Внешний coalesce делает «схемы нет» полноценным отрицательным ответом.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_tactic_fits(p_card_ids uuid[], p_tactic text)
returns boolean
language sql stable security definer set search_path = public as $$
  -- ⚠️ `as u(id)`, а не `as id`: без явного имени колонки `c.id = id` —
  -- двусмысленность (`id` есть и у cards, и у самого unnest), и Postgres
  -- отказывается создавать функцию с 42702.
  with lines as (
    select fantasy_position_key(c.facts->>'position') as pos
      from unnest(coalesce(p_card_ids, '{}'::uuid[])) as u(id)
      join cards c on c.id = u.id
  ),
  counted as (
    select count(*) filter (where pos in ('gk', 'def'))::int as defence,
           count(*) filter (where pos = 'fwd')::int          as forwards
      from lines
  )
  select coalesce((
           select counted.defence  >= coalesce(t.min_defence, 0)
              and counted.forwards >= coalesce(t.min_forwards, 0)
             from fantasy_tactic t
            where t.key = coalesce(p_tactic, 'balanced')
         ), false)
    from counted;
$$;

-- Список схем для экрана. Правило живёт в таблице, а не во второй копии на
-- TypeScript: расходиться им негде, если брать отсюда.
create or replace function public.fantasy_tactics()
returns table (
  key text, clean_sheet_x smallint, goal_x smallint,
  min_defence smallint, min_forwards smallint
)
language sql stable security definer set search_path = public as $$
  select t.key, t.clean_sheet_x, t.goal_x, t.min_defence, t.min_forwards
    from fantasy_tactic t order by t.sort_order;
$$;

-- ---------------------------------------------------------------------------
-- fantasy_options — та же выборка плюс позиция.
--
-- Аргументы НЕ меняются, меняется только набор колонок, поэтому уже
-- задеплоенный фронтенд переживёт это без правки: лишний ключ в JSON он просто
-- не читает. Сигнатуру трогать было бы нельзя — см. шим ниже.
-- ---------------------------------------------------------------------------
drop function if exists public.fantasy_options(bigint);

create function public.fantasy_options(p_round_id bigint)
returns table (
  card_id uuid, name text, name_en text, club text,
  match_count integer, position_key text
)
language sql stable security definer set search_path = public as $$
  with r as (select fr.starts_at, fr.ends_at from fantasy_round fr where fr.id = p_round_id)
  select cc.card_id, c.name, c.name_en, cc.club, count(*)::int,
         fantasy_position_key(c.facts->>'position')
    from card_current_club cc
    join cards c on c.id = cc.card_id and c.active and c.category = 'player'
    join fixtures f on cc.club_key in (club_match_key(f.home_team), club_match_key(f.away_team))
    cross join r
   where f.commence_at >= r.starts_at and f.commence_at < r.ends_at
   group by cc.card_id, c.name, c.name_en, cc.club, c.facts->>'position'
   order by count(*) desc, c.name;
$$;

-- ---------------------------------------------------------------------------
-- my_fantasy_squad — плюс позиция и выбранная схема. Аргументы те же, поэтому
-- старый фронтенд снова не ломается.
-- ---------------------------------------------------------------------------
drop function if exists public.my_fantasy_squad(text, bigint);

create function public.my_fantasy_squad(p_init_data text, p_round_id bigint)
returns table (
  card_id uuid, name text, club text, is_captain boolean, points integer,
  position_key text, tactic text
)
language plpgsql security definer set search_path = public as $$
declare v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  return query
    select p.card_id, c.name, cc.club, p.is_captain,
           (coalesce(pp.points, 0) * case when p.is_captain then 2 else 1 end)::int,
           fantasy_position_key(c.facts->>'position'),
           coalesce(st.tactic, 'balanced')
      from fantasy_pick p
      join cards c on c.id = p.card_id
      left join card_current_club cc on cc.card_id = p.card_id
      left join fantasy_squad_tactic st
             on st.round_id = p.round_id and st.player_id = p.player_id
      left join fantasy_pick_points(p_round_id) pp
             on pp.card_id = p.card_id and pp.player_id = p.player_id
     where p.round_id = p_round_id and p.player_id = v_me
     order by p.is_captain desc, c.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Запись состава со схемой.
--
-- ⚠️ У ФУНКЦИИ НЕТ ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ ДЛЯ p_tactic, И ЭТО НАРОЧНО. Со
-- значением по умолчанию вызов из четырёх аргументов подошёл бы И к старой
-- четырёхаргументной функции, И к этой — Postgres на такое отвечает
-- `function is not unique` и не вызывает ни одну. То есть «удобный» дефолт
-- уронил бы ровно тот фронтенд, ради которого старая версия оставлена.
--
-- Старая версия оставлена намеренно: она в проде прямо сейчас, и выкатка
-- фронтенда происходит не одновременно с миграцией. Это тот же приём, что и у
-- легаси-`pick_random_cards` в deck_rpc.sql, и та же причина — однажды снос
-- такого шима положил живое приложение.
-- ---------------------------------------------------------------------------
create or replace function public.set_fantasy_squad(
  p_init_data text, p_round_id bigint, p_card_ids uuid[], p_captain uuid, p_tactic text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_locks timestamptz;
  v_size integer := fantasy_squad_size();
  v_tactic text := coalesce(nullif(btrim(p_tactic), ''), 'balanced');
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  if p_card_ids is null or cardinality(p_card_ids) <> v_size then return false; end if;
  if cardinality(array(select distinct unnest(p_card_ids))) <> v_size then return false; end if;
  if p_captain is null or not (p_captain = any(p_card_ids)) then return false; end if;

  -- Незнакомая схема — отказ, а не тихий откат к «Балансу»: заявка со схемой,
  -- которую сервер не понял, не должна выглядеть принятой.
  if not exists (select 1 from fantasy_tactic t where t.key = v_tactic) then return false; end if;

  -- Время решает сервер. Это вся целостность фичи.
  v_locks := fantasy_locks_at(p_round_id);
  if v_locks is null or now() >= v_locks then return false; end if;

  if exists (select 1 from unnest(p_card_ids) as u(id)
              where u.id not in (select o.card_id from fantasy_options(p_round_id) o)) then
    return false;
  end if;

  -- Требование схемы к составу — на сервере, а не только в кнопке.
  if not fantasy_tactic_fits(p_card_ids, v_tactic) then return false; end if;

  delete from fantasy_pick where round_id = p_round_id and player_id = v_me;
  insert into fantasy_pick (round_id, player_id, card_id, is_captain)
  select p_round_id, v_me, u.id, u.id = p_captain from unnest(p_card_ids) as u(id);

  insert into fantasy_squad_tactic (round_id, player_id, tactic)
  values (p_round_id, v_me, v_tactic)
  on conflict (round_id, player_id) do update set tactic = excluded.tactic;
  return true;
end;
$$;

-- Шим для уже задеплоенного фронтенда: тот зовёт четырьмя аргументами и про
-- схемы не знает. «Баланс» — единственный честный ответ на «схему не выбирали»:
-- у него нет требований к составу и веса 1/1, то есть ровно прежнее поведение.
create or replace function public.set_fantasy_squad(
  p_init_data text, p_round_id bigint, p_card_ids uuid[], p_captain uuid
) returns boolean
language sql security definer set search_path = public as $$
  select set_fantasy_squad(p_init_data, p_round_id, p_card_ids, p_captain, 'balanced');
$$;

-- ---------------------------------------------------------------------------
-- Таблица лиг — теперь по очкам заявок, а не карточек.
-- ---------------------------------------------------------------------------
create or replace function public.fantasy_standings(p_init_data text, p_round_id bigint)
returns table (
  league_id bigint, league_name text, player_id bigint,
  first_name text, last_name text, avatar_url text,
  points integer, picked integer
)
language plpgsql security definer set search_path = public as $$
declare v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  return query
    with mine as (select m.league_id from fantasy_league_member m where m.player_id = v_me),
    scored as (
      select p.player_id,
             sum(coalesce(pp.points, 0) * case when p.is_captain then 2 else 1 end)::int as pts,
             count(*)::int as picked
        from fantasy_pick p
        left join fantasy_pick_points(p_round_id) pp
               on pp.card_id = p.card_id and pp.player_id = p.player_id
       where p.round_id = p_round_id group by p.player_id
    )
    select l.id, l.name, pl.id, pl.first_name, pl.last_name, pl.avatar_url,
           coalesce(s.pts, 0), coalesce(s.picked, 0)
      from mine
      join fantasy_league l on l.id = mine.league_id
      join fantasy_league_member mem on mem.league_id = l.id
      join players pl on pl.id = mem.player_id
      left join scored s on s.player_id = pl.id
     order by l.id, coalesce(s.pts, 0) desc, pl.first_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Гранты. Таблиц игрокам по-прежнему не видно — только функции.
-- ---------------------------------------------------------------------------
revoke all on function public.fantasy_position_key(text)                              from public;
revoke all on function public.fantasy_clean_sheet_points(text)                         from public;
revoke all on function public.fantasy_goal_points(text)                                from public;
revoke all on function public.fantasy_tactic_points(smallint, smallint, text, text)    from public;
revoke all on function public.fantasy_pick_points(bigint)                              from public;
revoke all on function public.fantasy_tactic_fits(uuid[], text)                        from public;
revoke all on function public.fantasy_tactics()                                        from public;
revoke all on function public.fantasy_options(bigint)                                  from public;
revoke all on function public.my_fantasy_squad(text, bigint)                           from public;
revoke all on function public.set_fantasy_squad(text, bigint, uuid[], uuid, text)      from public;
revoke all on function public.set_fantasy_squad(text, bigint, uuid[], uuid)            from public;
revoke all on function public.fantasy_standings(text, bigint)                          from public;

grant execute on function public.fantasy_position_key(text)                           to anon, authenticated, service_role;
grant execute on function public.fantasy_clean_sheet_points(text)                      to anon, authenticated, service_role;
grant execute on function public.fantasy_goal_points(text)                             to anon, authenticated, service_role;
grant execute on function public.fantasy_tactic_points(smallint, smallint, text, text) to anon, authenticated, service_role;
grant execute on function public.fantasy_pick_points(bigint)                           to anon, authenticated, service_role;
grant execute on function public.fantasy_tactic_fits(uuid[], text)                     to anon, authenticated, service_role;
grant execute on function public.fantasy_tactics()                                     to anon, authenticated, service_role;
grant execute on function public.fantasy_options(bigint)                               to anon, authenticated, service_role;
grant execute on function public.my_fantasy_squad(text, bigint)                        to anon, authenticated, service_role;
grant execute on function public.set_fantasy_squad(text, bigint, uuid[], uuid, text)   to anon, authenticated, service_role;
grant execute on function public.set_fantasy_squad(text, bigint, uuid[], uuid)         to anon, authenticated, service_role;
grant execute on function public.fantasy_standings(text, bigint)                       to anon, authenticated, service_role;
