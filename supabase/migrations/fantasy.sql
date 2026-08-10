-- ============================================================================
-- SHERLOCK SCHOLES — фэнтези-лига (путь A: очки за результат клуба)
--
-- Устройство и обоснование — docs/FANTASY_AND_MINIGAMES.md. Коротко: постатейной
-- статистики игроков нет и бесплатно не будет, поэтому карточка зарабатывает за
-- результат СВОЕГО КЛУБА в матчах тура. Связь «карточка → клуб → матч» уже
-- существовала: card_current_club + club_match_key(), та же функция, на которой
-- работает фильтр составов. Замер на 10 августа 2026: 464 карточки доступны к
-- выбору в ближайшем открытом туре.
--
-- ДВА РАЗНЫХ ВОПРОСА, И ИХ НЕЛЬЗЯ ПУТАТЬ.
--   current_fantasy_round() — неделя, В КОТОРОЙ МЫ СЕЙЧАС. Про неё таблица.
--   open_fantasy_round()    — ближайшая неделя, состав на которую ЕЩЁ МОЖНО
--                             собрать. Обычно следующая.
-- Без второй функции фича мертворождённая: тур закрывается первым стартовым
-- свистком недели, то есть всякий, кто зашёл после вечера понедельника, видит
-- тур, который был закрыт в момент создания. Проверено: тур недели 10 августа
-- заблокировался в 16:30 того же дня.
--
-- ЛОВУШКА, КОТОРАЯ СЪЕЛА ФУНКЦИЮ ЦЕЛИКОМ. В `LANGUAGE sql` функции имена
-- выходных колонок RETURNS TABLE находятся в области видимости как переменные.
-- Колонка называлась `fixtures` — и `join fixtures f` связался с целым числом
-- вместо таблицы. Функция молча вернула ноль строк, без единой ошибки. Ни одна
-- выходная колонка не должна называться так же, как таблица, которую функция
-- читает.
--
-- БЕЗОПАСНОСТЬ. Все четыре таблицы с RLS и без единого гранта игрокам: доступ
-- только через SECURITY DEFINER ниже, и каждая запись выводит игрока из
-- подписанного initData. Состав нельзя поставить после блокировки — время
-- решает Postgres, а не телефон.
-- ============================================================================

create table if not exists public.fantasy_round (
  id          bigserial primary key,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  settled_at  timestamptz,
  unique (starts_at)
);

create table if not exists public.fantasy_pick (
  round_id    bigint not null references public.fantasy_round(id) on delete cascade,
  player_id   bigint not null references public.players(id)       on delete cascade,
  card_id     uuid   not null references public.cards(id)         on delete cascade,
  is_captain  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (round_id, player_id, card_id)
);
create index if not exists fantasy_pick_round_idx on public.fantasy_pick (round_id, player_id);

create table if not exists public.fantasy_league (
  id         bigserial primary key,
  owner_id   bigint not null references public.players(id) on delete cascade,
  name       text   not null check (btrim(name) <> ''),
  join_code  char(6) not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.fantasy_league_member (
  league_id  bigint not null references public.fantasy_league(id) on delete cascade,
  player_id  bigint not null references public.players(id)        on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (league_id, player_id)
);

alter table public.fantasy_round         enable row level security;
alter table public.fantasy_pick          enable row level security;
alter table public.fantasy_league        enable row level security;
alter table public.fantasy_league_member enable row level security;
revoke all on public.fantasy_round         from public, anon, authenticated;
revoke all on public.fantasy_pick          from public, anon, authenticated;
revoke all on public.fantasy_league        from public, anon, authenticated;
revoke all on public.fantasy_league_member from public, anon, authenticated;

create or replace function public.fantasy_squad_size() returns integer
language sql immutable as $$ select 5 $$;

-- Правило начисления, отдельной IMMUTABLE-функцией — как prediction_points,
-- чтобы его можно было проверить и показать игроку, не читая UPDATE.
-- Проверено: 2:0 → 7, 1:1 → 2, 0:0 → 3, 0:4 → −1.
create or replace function public.fantasy_match_points(
  p_scored smallint, p_conceded smallint
) returns integer
language sql immutable as $$
  select case when p_scored > p_conceded then 3 when p_scored = p_conceded then 1 else 0 end
       + case when p_conceded = 0 then 2 else 0 end
       + coalesce(p_scored, 0)
       + case when p_conceded - p_scored >= 3 then -1 else 0 end;
$$;

-- Неделя, в которой мы сейчас. Создаётся по требованию — планировщик не нужен.
create or replace function public.current_fantasy_round()
returns public.fantasy_round
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  v_round fantasy_round;
begin
  select * into v_round from fantasy_round where starts_at = v_start;
  if found then return v_round; end if;
  insert into fantasy_round (starts_at, ends_at) values (v_start, v_start + interval '7 days')
  on conflict (starts_at) do update set ends_at = excluded.ends_at returning * into v_round;
  return v_round;
end;
$$;

-- Момент закрытия приёма — первый стартовый свисток тура. Выводится, а не
-- хранится: расписание уточняется, а вторая копия времени разошлась бы с первой.
create or replace function public.fantasy_locks_at(p_round_id bigint)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(f.commence_at) from fixtures f, fantasy_round r
   where r.id = p_round_id and f.commence_at >= r.starts_at and f.commence_at < r.ends_at;
$$;

-- Ближайший тур, состав на который ещё можно собрать. См. шапку файла.
create or replace function public.open_fantasy_round()
returns public.fantasy_round
language plpgsql security definer set search_path = public as $$
declare
  v_round fantasy_round; v_start timestamptz; v_locks timestamptz;
begin
  v_round := current_fantasy_round();
  v_locks := fantasy_locks_at(v_round.id);
  -- Пустая неделя — не закрытая: это неделя, до которой не дошло расписание.
  if v_locks is null or now() < v_locks then return v_round; end if;
  v_start := v_round.starts_at + interval '7 days';
  select * into v_round from fantasy_round where starts_at = v_start;
  if found then return v_round; end if;
  insert into fantasy_round (starts_at, ends_at) values (v_start, v_start + interval '7 days')
  on conflict (starts_at) do update set ends_at = excluded.ends_at returning * into v_round;
  return v_round;
end;
$$;

-- Очки каждой карточки за тур. Не колонка, а функция — по той же причине, по
-- которой cards_matching один: два места, считающие одно число, разойдутся.
create or replace function public.fantasy_card_points(p_round_id bigint)
returns table (card_id uuid, points integer, matches integer)
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
  select card_id, coalesce(sum(fantasy_match_points(scored, conceded)), 0)::int, count(*)::int
    from played group by card_id;
$$;

-- Кого можно выбрать. `match_count`, а НЕ `fixtures` — см. ловушку в шапке.
create or replace function public.fantasy_options(p_round_id bigint)
returns table (card_id uuid, name text, name_en text, club text, match_count integer)
language sql stable security definer set search_path = public as $$
  with r as (select fr.starts_at, fr.ends_at from fantasy_round fr where fr.id = p_round_id)
  select cc.card_id, c.name, c.name_en, cc.club, count(*)::int
    from card_current_club cc
    join cards c on c.id = cc.card_id and c.active and c.category = 'player'
    join fixtures f on cc.club_key in (club_match_key(f.home_team), club_match_key(f.away_team))
    cross join r
   where f.commence_at >= r.starts_at and f.commence_at < r.ends_at
   group by cc.card_id, c.name, c.name_en, cc.club
   order by count(*) desc, c.name;
$$;

-- ---------------------------------------------------------------------------
-- Запись состава. Отказ — обычный ответ, а не только сбой: тур закрыт, размер
-- не тот, капитан вне состава, карточка не играет в этом туре.
-- ---------------------------------------------------------------------------
create or replace function public.set_fantasy_squad(
  p_init_data text, p_round_id bigint, p_card_ids uuid[], p_captain uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_locks timestamptz;
  v_size integer := fantasy_squad_size();
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  if p_card_ids is null or cardinality(p_card_ids) <> v_size then return false; end if;
  -- Пять одинаковых карточек — это не состав из пяти.
  if cardinality(array(select distinct unnest(p_card_ids))) <> v_size then return false; end if;
  if p_captain is null or not (p_captain = any(p_card_ids)) then return false; end if;

  -- Время решает сервер. Это вся целостность фичи.
  v_locks := fantasy_locks_at(p_round_id);
  if v_locks is null or now() >= v_locks then return false; end if;

  if exists (select 1 from unnest(p_card_ids) as id
              where id not in (select o.card_id from fantasy_options(p_round_id) o)) then
    return false;
  end if;

  delete from fantasy_pick where round_id = p_round_id and player_id = v_me;
  insert into fantasy_pick (round_id, player_id, card_id, is_captain)
  select p_round_id, v_me, id, id = p_captain from unnest(p_card_ids) as id;
  return true;
end;
$$;

create or replace function public.my_fantasy_squad(p_init_data text, p_round_id bigint)
returns table (card_id uuid, name text, club text, is_captain boolean, points integer)
language plpgsql security definer set search_path = public as $$
declare v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  return query
    select p.card_id, c.name, cc.club, p.is_captain,
           (coalesce(cp.points, 0) * case when p.is_captain then 2 else 1 end)::int
      from fantasy_pick p
      join cards c on c.id = p.card_id
      left join card_current_club cc on cc.card_id = p.card_id
      left join fantasy_card_points(p_round_id) cp on cp.card_id = p.card_id
     where p.round_id = p_round_id and p.player_id = v_me
     order by p.is_captain desc, c.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Лиги. Код лиги генерируется без O/I/0/1/l — их путают вслух и на глаз, а этот
-- код людям придётся диктовать.
-- ---------------------------------------------------------------------------
create or replace function public.create_fantasy_league(p_init_data text, p_name text)
returns table (id bigint, join_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_code char(6); v_id bigint;
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  if p_name is null or btrim(p_name) = '' then return; end if;

  for attempt in 1..20 loop
    v_code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=OI01l', 'ABCDEFGH'), 1, 6));
    begin
      insert into fantasy_league (owner_id, name, join_code) values (v_me, btrim(p_name), v_code)
        returning fantasy_league.id into v_id;
      exit;
    exception when unique_violation then v_id := null;
    end;
  end loop;
  if v_id is null then return; end if;

  insert into fantasy_league_member (league_id, player_id) values (v_id, v_me) on conflict do nothing;
  return query select v_id, v_code::text;
end;
$$;

create or replace function public.join_fantasy_league(p_init_data text, p_code text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_me bigint := tg_validate_init_data(p_init_data); v_id bigint;
begin
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  select l.id into v_id from fantasy_league l
   where upper(btrim(l.join_code)) = upper(btrim(coalesce(p_code, '')));
  if v_id is null then return null; end if;
  insert into fantasy_league_member (league_id, player_id) values (v_id, v_me) on conflict do nothing;
  return v_id;
end;
$$;

-- Таблица по всем лигам, где состоит вызывающий. Капитан удваивается здесь же,
-- а не хранится удвоенным — иначе смена капитана переписала бы историю.
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
             sum(coalesce(cp.points, 0) * case when p.is_captain then 2 else 1 end)::int as pts,
             count(*)::int as picked
        from fantasy_pick p
        left join fantasy_card_points(p_round_id) cp on cp.card_id = p.card_id
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
-- Гранты. Таблиц игрокам не видно вовсе — только функции.
-- ---------------------------------------------------------------------------
revoke all on function public.fantasy_squad_size()                              from public;
revoke all on function public.fantasy_match_points(smallint, smallint)          from public;
revoke all on function public.current_fantasy_round()                           from public;
revoke all on function public.open_fantasy_round()                              from public;
revoke all on function public.fantasy_locks_at(bigint)                          from public;
revoke all on function public.fantasy_card_points(bigint)                       from public;
revoke all on function public.fantasy_options(bigint)                           from public;
revoke all on function public.set_fantasy_squad(text, bigint, uuid[], uuid)     from public;
revoke all on function public.my_fantasy_squad(text, bigint)                    from public;
revoke all on function public.create_fantasy_league(text, text)                 from public;
revoke all on function public.join_fantasy_league(text, text)                   from public;
revoke all on function public.fantasy_standings(text, bigint)                   from public;

grant execute on function public.fantasy_squad_size()                          to anon, authenticated, service_role;
grant execute on function public.fantasy_match_points(smallint, smallint)      to anon, authenticated, service_role;
grant execute on function public.current_fantasy_round()                       to anon, authenticated, service_role;
grant execute on function public.open_fantasy_round()                          to anon, authenticated, service_role;
grant execute on function public.fantasy_locks_at(bigint)                      to anon, authenticated, service_role;
grant execute on function public.fantasy_card_points(bigint)                   to anon, authenticated, service_role;
grant execute on function public.fantasy_options(bigint)                       to anon, authenticated, service_role;
grant execute on function public.set_fantasy_squad(text, bigint, uuid[], uuid) to anon, authenticated, service_role;
grant execute on function public.my_fantasy_squad(text, bigint)                to anon, authenticated, service_role;
grant execute on function public.create_fantasy_league(text, text)             to anon, authenticated, service_role;
grant execute on function public.join_fantasy_league(text, text)               to anon, authenticated, service_role;
grant execute on function public.fantasy_standings(text, bigint)               to anon, authenticated, service_role;
