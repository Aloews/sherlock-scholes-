-- ============================================================================
-- ФАН-КЛУБЫ: болельщики одного клуба находят друг друга.
--
-- ЗАЧЕМ. «Организовывать фанатские клубы» — последняя невыполненная часть
-- просьбы про соцчасть. Присутствие (player_presence.sql) уже отвечает, КТО
-- сейчас в приложении; фан-клуб отвечает, кто из них СВОИ.
--
-- ⚠️ ОДИН ФАН-КЛУБ НА ОДИН НАСТОЯЩИЙ КЛУБ, отсюда `unique (club_key)`.
-- Свободное создание дало бы девять «фан-клубов Реала» с тремя людьми в
-- каждом — то есть ровно то, ради чего клуб и заводят (найти своих), не
-- работало бы. «Основать» здесь значит просто вступить первым.
--
-- ⚠️ КЛЮЧ ПРОВЕРЯЕТСЯ ПО СПРАВОЧНИКУ, А НЕ ПРИНИМАЕТСЯ НА ВЕРУ. Без этого
-- `join_fan_club('клуб имени меня')` завёл бы что угодно, и список превратился
-- бы в свалку. Настоящим считается клуб, который либо есть у карточек игроков
-- (`card_current_club`), либо играет в ближайших матчах (`fixtures`).
--
-- ⚠️ И NULL-КЛЮЧ ОТБИВАЕТСЯ ОТДЕЛЬНО. `club_match_key` вырезает всё, кроме
-- [a-z0-9], поэтому на кириллице отдаёт NULL — на этом уже спотыкался
-- `fill_missing_clubs`, где 74 кандидата из 95 пришли бы с пустым ключом.
-- Пустой ключ здесь означал бы фан-клуб, к которому нельзя присоединиться
-- второй раз, потому что `unique` по NULL не работает.
--
-- Личность — из подписанной initData, как во всех функциях проекта.
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

create table if not exists fan_club (
  id         uuid primary key default gen_random_uuid(),
  club_key   text not null unique,
  club       text not null,
  founder_id bigint references players(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table fan_club is
  'Один фан-клуб на один настоящий клуб (unique club_key). «Основать» = '
  'вступить первым.';

create table if not exists fan_club_member (
  club_id   uuid   not null references fan_club(id) on delete cascade,
  player_id bigint not null references players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, player_id)
);

create index if not exists fan_club_member_player_idx on fan_club_member (player_id);

-- ---------------------------------------------------------------------------
-- Настоящий ли это клуб.
-- ---------------------------------------------------------------------------
create or replace function public.is_real_club(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_key is not null and (
       exists (select 1 from card_current_club where club_key = p_key)
    or exists (select 1 from fixtures
                where club_match_key(home_team) = p_key
                   or club_match_key(away_team) = p_key)
  )
$$;

comment on function public.is_real_club(text) is
  'Клуб есть у карточек игроков или играет в расписании. Без этой проверки '
  'фан-клубом можно было бы объявить любую строку.';

-- ---------------------------------------------------------------------------
-- Вступить (и основать, если никого ещё не было).
-- ---------------------------------------------------------------------------
create or replace function public.join_fan_club(p_init_data text, p_club text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me  bigint := tg_validate_init_data(p_init_data);
  v_key text   := club_match_key(p_club);
  v_id  uuid;
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  -- ⚠️ Голое `if not is_real_club(...)` ушло бы в ложную ветку на NULL и
  -- пропустило бы мусор дальше — ловушка, записанная в CLAUDE.md.
  if not coalesce(is_real_club(v_key), false) then
    raise exception 'unknown club' using errcode = '22023';
  end if;

  insert into fan_club (club_key, club, founder_id)
  values (v_key, btrim(p_club), v_me)
  on conflict (club_key) do update set club = fan_club.club
  returning id into v_id;

  insert into fan_club_member (club_id, player_id)
  values (v_id, v_me)
  on conflict do nothing;

  return v_id;
end;
$$;

comment on function public.join_fan_club(text, text) is
  'Вступить в фан-клуб; первый вступивший его и заводит. Клуб проверяется по '
  'справочнику, ключ на кириллице (NULL) отбивается.';

create or replace function public.leave_fan_club(p_init_data text, p_club text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me  bigint := tg_validate_init_data(p_init_data);
  v_key text   := club_match_key(p_club);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  delete from fan_club_member m
   using fan_club c
   where m.club_id = c.id and c.club_key = v_key and m.player_id = v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Какие есть фан-клубы. Свои — первыми.
-- ---------------------------------------------------------------------------
create or replace function public.fan_clubs(p_init_data text, p_limit int default 40)
returns table (
  club_key text, club text, members int, i_am_in boolean, online int
)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    select c.club_key, c.club,
           count(m.player_id)::int,
           bool_or(m.player_id = v_me),
           -- Сколько СВОИХ сейчас в приложении. Ради этого фан-клуб и нужен
           -- рядом с присутствием: «наши онлайн» — повод позвать смотреть.
           count(*) filter (
             where pr.seen_at > now() - presence_window() and not pr.hidden
           )::int
      from fan_club c
      left join fan_club_member m on m.club_id = c.id
      left join player_presence  pr on pr.player_id = m.player_id
     group by c.club_key, c.club
     order by bool_or(m.player_id = v_me) desc nulls last,
              count(m.player_id) desc, c.club
     limit greatest(1, least(p_limit, 100));
end;
$$;

comment on function public.fan_clubs(text, int) is
  'Фан-клубы с числом участников и сколько их сейчас в приложении. Свои '
  'первыми.';

-- ---------------------------------------------------------------------------
-- Гранты. Таблицы игрокам не отдаются — только через функции выше.
-- ---------------------------------------------------------------------------
revoke all on table fan_club, fan_club_member from public, anon, authenticated;
grant select, insert, update, delete on table fan_club, fan_club_member to service_role;

revoke all on function public.join_fan_club(text, text) from public;
revoke all on function public.leave_fan_club(text, text) from public;
revoke all on function public.fan_clubs(text, int) from public;
revoke all on function public.is_real_club(text) from public;
grant execute on function public.join_fan_club(text, text) to anon, authenticated, service_role;
grant execute on function public.leave_fan_club(text, text) to anon, authenticated, service_role;
grant execute on function public.fan_clubs(text, int) to anon, authenticated, service_role;
grant execute on function public.is_real_club(text) to service_role;
