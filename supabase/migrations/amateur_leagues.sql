-- ============================================================================
-- ЛЮБИТЕЛЬСКИЕ ЛИГИ: своя лига, своя команда, ты сам как игрок.
--
-- Владелец: «возможность добавлять любительские лиги и себя, как игрока в них,
-- загружать лого команды и лиги».
--
-- ⚠️ ЭТО ПЕРВЫЙ РАЗДЕЛ ПРИЛОЖЕНИЯ, КУДА ПИШУТ ПОЛЬЗОВАТЕЛИ. Всё остальное
-- собрано нами из внешних источников и доступно только на чтение. Отсюда три
-- решения, каждое — не перестраховка:
--
--   1. ПИШУТ ТОЛЬКО ЧЕРЕЗ RPC С ПОДПИСЬЮ. У таблиц нет ни одного гранта на
--      insert/update/delete для anon: политика «true» на запись означала бы,
--      что любой с анонимным ключом (а он в каждом браузере) правит чужие
--      лиги. Все изменения идут через функции, которые сперва зовут
--      `tg_validate_init_data` и берут telegram_id ИЗ ПОДПИСИ, а не из
--      параметра.
--
--   2. ВИДНО НЕ ВСЕМ, А ПО КОДУ. Лига не выводится ни в какой общий список:
--      чтобы попасть в неё, нужен восьмизначный код от создателя. Это и
--      продуктовое решение (двор не хочет быть в каталоге), и защита: раздел с
--      пользовательскими названиями и картинками, открытый всему миру, — это
--      витрина для того, что туда напишут.
--
--   3. ПРЕДЕЛЫ ЗАПИСАНЫ В БАЗЕ, А НЕ В ЭКРАНЕ. Экран можно обойти.
--
-- ⚠️ ЛОГОТИПЫ НЕ ЗАГРУЖАЮТСЯ НАПРЯМУЮ ИЗ БРАУЗЕРА. У игрока нет своего
-- Supabase-токена — он аноним с общим ключом, и грант на запись в корзину
-- отдал бы её всем. Загрузка идёт через Edge-функцию `amateur-logo`, которая
-- проверяет подпись, проверяет, что человек ВЛАДЕЛЕЦ, и пишет сервисным
-- ключом. Поле `logo_url` тоже правится только ею.
-- ============================================================================

create table if not exists public.amateur_league (
  id         uuid primary key default gen_random_uuid(),
  name       text   not null check (btrim(name) <> '' and length(name) <= 60),
  city       text   check (length(city) <= 60),
  logo_url   text,
  owner_tg   bigint not null,
  -- Код приглашения. Без него в лигу не попасть — см. решение 2 в шапке.
  join_code  text   not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.amateur_team (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid   not null references public.amateur_league(id) on delete cascade,
  name       text   not null check (btrim(name) <> '' and length(name) <= 60),
  logo_url   text,
  owner_tg   bigint not null,
  created_at timestamptz not null default now(),
  unique (league_id, name)
);

create table if not exists public.amateur_player (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid   not null references public.amateur_team(id) on delete cascade,
  telegram_id  bigint not null,
  display_name text   not null check (btrim(display_name) <> '' and length(display_name) <= 60),
  -- Амплуа из того же перечня, что у настоящих игроков: иначе экраны
  -- любительской лиги и колоды разойдутся в словах об одном и том же.
  player_position text check (player_position in ('goalkeeper','defender','midfield','attack')),
  shirt_no     smallint check (shirt_no between 1 and 99),
  created_at   timestamptz not null default now(),
  -- Один человек — одна запись в команде. Без этого «добавь себя» дважды
  -- нажатое давало бы двух игроков с одним именем.
  unique (team_id, telegram_id)
);

create index if not exists amateur_team_league_idx  on public.amateur_team (league_id);
create index if not exists amateur_player_team_idx  on public.amateur_player (team_id);
create index if not exists amateur_player_tg_idx    on public.amateur_player (telegram_id);
create index if not exists amateur_league_owner_idx on public.amateur_league (owner_tg);

comment on table public.amateur_league is
  'Любительская лига, заведённая игроком. Видна по коду приглашения, а не в общем списке.';
comment on table public.amateur_team is 'Команда внутри любительской лиги.';
comment on table public.amateur_player is 'Человек, записавший себя в любительскую команду.';

-- ⚠️ RLS ВКЛЮЧЕНА, А ПОЛИТИК НА ЗАПИСЬ НЕТ ВОВСЕ. Читать таблицы напрямую
-- анониму тоже незачем: всё отдают функции ниже, и они решают, что показать.
alter table public.amateur_league enable row level security;
alter table public.amateur_team   enable row level security;
alter table public.amateur_player enable row level security;

revoke all on public.amateur_league from anon, authenticated;
revoke all on public.amateur_team   from anon, authenticated;
revoke all on public.amateur_player from anon, authenticated;
grant all on public.amateur_league to service_role;
grant all on public.amateur_team   to service_role;
grant all on public.amateur_player to service_role;

-- ── Код приглашения ─────────────────────────────────────────────────────────
-- Восемь знаков без похожих друг на друга: 0/O и 1/I/l в коде, продиктованном
-- голосом во дворе, читаются неверно чаще, чем кажется.
create or replace function public.amateur_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
begin
  for attempt in 1..20 loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    if not exists (select 1 from amateur_league l where l.join_code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'не удалось подобрать свободный код';
end;
$$;

revoke all on function public.amateur_new_code() from public;

-- ── Кто это вообще ──────────────────────────────────────────────────────────
-- ⚠️ TELEGRAM_ID БЕРЁТСЯ ИЗ ПОДПИСИ, А НЕ ИЗ ПАРАМЕТРА. Параметром его подал
-- бы кто угодно и завёл бы лигу от чужого имени.
create or replace function public.amateur_me(p_init_data text)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v_id bigint;
begin
  v_id := public.tg_validate_init_data(p_init_data);
  if v_id is null then
    raise exception 'нужна подпись Telegram' using errcode = '42501', hint = 'bad_signature';
  end if;
  return v_id;
end;
$$;

revoke all on function public.amateur_me(text) from public;
grant execute on function public.amateur_me(text) to anon, authenticated, service_role;

-- ── Завести лигу ────────────────────────────────────────────────────────────
create or replace function public.amateur_create_league(
  p_init_data text, p_name text, p_city text default null)
returns table (id uuid, name text, city text, join_code text)
language plpgsql security definer set search_path = public as $$
declare v_me bigint; v_id uuid; v_code text;
begin
  v_me := public.amateur_me(p_init_data);

  -- ⚠️ ПРЕДЕЛ НА ЧЕЛОВЕКА — В БАЗЕ. Экран можно обойти, а десять тысяч лиг от
  -- одного telegram_id — это не «активный пользователь», это заливка.
  if (select count(*) from amateur_league l where l.owner_tg = v_me) >= 20 then
    raise exception 'больше двадцати лиг на одного человека не заводится'
      using errcode = '22023', hint = 'too_many_leagues';
  end if;

  v_code := public.amateur_new_code();
  insert into amateur_league (name, city, owner_tg, join_code)
  values (btrim(p_name), nullif(btrim(coalesce(p_city, '')), ''), v_me, v_code)
  returning amateur_league.id into v_id;

  return query
    select l.id, l.name, l.city, l.join_code from amateur_league l where l.id = v_id;
end;
$$;

revoke all on function public.amateur_create_league(text, text, text) from public;
grant execute on function public.amateur_create_league(text, text, text)
  to anon, authenticated, service_role;

-- ── Завести команду в лиге ──────────────────────────────────────────────────
create or replace function public.amateur_create_team(
  p_init_data text, p_league_id uuid, p_name text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare v_me bigint; v_id uuid;
begin
  v_me := public.amateur_me(p_init_data);

  if not exists (select 1 from amateur_league l where l.id = p_league_id) then
    raise exception 'лига не найдена' using errcode = 'P0002', hint = 'no_league';
  end if;

  if (select count(*) from amateur_team t where t.league_id = p_league_id) >= 64 then
    raise exception 'в лиге уже шестьдесят четыре команды'
      using errcode = '22023', hint = 'league_full';
  end if;

  insert into amateur_team (league_id, name, owner_tg)
  values (p_league_id, btrim(p_name), v_me)
  returning amateur_team.id into v_id;

  return query select t.id, t.name from amateur_team t where t.id = v_id;
end;
$$;

revoke all on function public.amateur_create_team(text, uuid, text) from public;
grant execute on function public.amateur_create_team(text, uuid, text)
  to anon, authenticated, service_role;

-- ── Записать СЕБЯ в команду ─────────────────────────────────────────────────
-- ⚠️ ТОЛЬКО СЕБЯ. Записать за другого нельзя вовсе: telegram_id берётся из
-- подписи. Иначе в любительской лиге появлялись бы люди, которые о ней не
-- знают, — с именем и номером.
create or replace function public.amateur_join_team(
  p_init_data text, p_team_id uuid, p_display_name text,
  p_position text default null, p_shirt_no smallint default null)
returns table (id uuid, display_name text)
language plpgsql security definer set search_path = public as $$
declare v_me bigint; v_id uuid;
begin
  v_me := public.amateur_me(p_init_data);

  if not exists (select 1 from amateur_team t where t.id = p_team_id) then
    raise exception 'команда не найдена' using errcode = 'P0002', hint = 'no_team';
  end if;

  if (select count(*) from amateur_player p where p.team_id = p_team_id) >= 40 then
    raise exception 'в команде уже сорок игроков'
      using errcode = '22023', hint = 'team_full';
  end if;

  insert into amateur_player (team_id, telegram_id, display_name, player_position, shirt_no)
  values (p_team_id, v_me, btrim(p_display_name),
          nullif(p_position, ''), p_shirt_no)
  on conflict (team_id, telegram_id) do update
    set display_name = excluded.display_name,
        player_position = excluded.player_position,
        shirt_no = excluded.shirt_no
  returning amateur_player.id into v_id;

  return query select p.id, p.display_name from amateur_player p where p.id = v_id;
end;
$$;

revoke all on function public.amateur_join_team(text, uuid, text, text, smallint) from public;
grant execute on function public.amateur_join_team(text, uuid, text, text, smallint)
  to anon, authenticated, service_role;

-- ── Уйти из команды ─────────────────────────────────────────────────────────
create or replace function public.amateur_leave_team(p_init_data text, p_team_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_me bigint; v_n integer;
begin
  v_me := public.amateur_me(p_init_data);
  delete from amateur_player p where p.team_id = p_team_id and p.telegram_id = v_me;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.amateur_leave_team(text, uuid) from public;
grant execute on function public.amateur_leave_team(text, uuid)
  to anon, authenticated, service_role;

-- ── Что показать: мои лиги ──────────────────────────────────────────────────
-- Мои — это заведённые мной ИЛИ те, где я записан игроком. Второе важнее:
-- игрок двора не заводит лигу, он в неё вступает, и без этого его экран был
-- бы пуст.
create or replace function public.amateur_my_leagues(p_init_data text)
returns table (id uuid, name text, city text, logo_url text, join_code text,
               teams integer, players integer, is_owner boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint;
begin
  v_me := public.amateur_me(p_init_data);
  return query
    select l.id, l.name, l.city, l.logo_url,
           -- ⚠️ КОД ВИДИТ ТОЛЬКО ВЛАДЕЛЕЦ. Участнику он не нужен, а раздать
           -- его — значит раздать приглашение в чужую лигу.
           case when l.owner_tg = v_me then l.join_code end,
           (select count(*)::int from amateur_team t where t.league_id = l.id),
           (select count(*)::int from amateur_player p
              join amateur_team t on t.id = p.team_id where t.league_id = l.id),
           l.owner_tg = v_me
      from amateur_league l
     where l.owner_tg = v_me
        or exists (select 1 from amateur_player p
                     join amateur_team t on t.id = p.team_id
                    where t.league_id = l.id and p.telegram_id = v_me)
     order by l.created_at desc;
end;
$$;

revoke all on function public.amateur_my_leagues(text) from public;
grant execute on function public.amateur_my_leagues(text) to anon, authenticated, service_role;

-- ── Что показать: одна лига ─────────────────────────────────────────────────
create or replace function public.amateur_league_view(p_init_data text, p_league_id uuid)
returns table (team_id uuid, team_name text, team_logo text, team_owner boolean,
               player_id uuid, player_name text, player_position text,
               shirt_no smallint, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint;
begin
  v_me := public.amateur_me(p_init_data);
  -- Видеть лигу может тот, кто её завёл, или тот, кто в ней играет. Чужую по
  -- угаданному uuid не открыть.
  if not exists (
    select 1 from amateur_league l
     where l.id = p_league_id
       and (l.owner_tg = v_me
            or exists (select 1 from amateur_player p
                         join amateur_team t on t.id = p.team_id
                        where t.league_id = l.id and p.telegram_id = v_me))
  ) then
    raise exception 'лига не ваша' using errcode = '42501', hint = 'not_member';
  end if;

  return query
    select t.id, t.name, t.logo_url, t.owner_tg = v_me,
           p.id, p.display_name, p.player_position, p.shirt_no,
           coalesce(p.telegram_id = v_me, false)
      from amateur_team t
      left join amateur_player p on p.team_id = t.id
     where t.league_id = p_league_id
     order by t.created_at, p.shirt_no nulls last, p.created_at;
end;
$$;

revoke all on function public.amateur_league_view(text, uuid) from public;
grant execute on function public.amateur_league_view(text, uuid)
  to anon, authenticated, service_role;

-- ── Войти по коду ───────────────────────────────────────────────────────────
create or replace function public.amateur_league_by_code(p_init_data text, p_code text)
returns table (id uuid, name text, city text, logo_url text)
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint;
begin
  -- Подпись нужна даже на чтение по коду: иначе код можно перебирать анонимно.
  v_me := public.amateur_me(p_init_data);
  return query
    select l.id, l.name, l.city, l.logo_url
      from amateur_league l
     where l.join_code = upper(btrim(p_code));
end;
$$;

revoke all on function public.amateur_league_by_code(text, text) from public;
grant execute on function public.amateur_league_by_code(text, text)
  to anon, authenticated, service_role;

-- ── Логотип: пишет ТОЛЬКО Edge-функция сервисным ключом ────────────────────
-- Проверка владения — здесь, а не в функции: правило «кто может менять
-- логотип» должно жить в одном месте с данными.
create or replace function public.amateur_set_logo(
  p_telegram_id bigint, p_kind text, p_id uuid, p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_kind = 'league' then
    update amateur_league l set logo_url = p_url
     where l.id = p_id and l.owner_tg = p_telegram_id;
  elsif p_kind = 'team' then
    update amateur_team t set logo_url = p_url
     where t.id = p_id and t.owner_tg = p_telegram_id;
  else
    raise exception 'неизвестный вид: %', p_kind using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ⚠️ ГРАНТ ТОЛЬКО service_role. Эту функцию зовёт Edge-функция после проверки
-- подписи; дать её анониму значило бы отдать логотипы всем — telegram_id здесь
-- приходит параметром, а не из подписи.
revoke all on function public.amateur_set_logo(bigint, text, uuid, text) from public;
grant execute on function public.amateur_set_logo(bigint, text, uuid, text) to service_role;
