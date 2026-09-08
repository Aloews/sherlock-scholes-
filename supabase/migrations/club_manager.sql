-- Тренер клуба, и честная граница того, что мы про него знаем.
-- ===========================================================================
--
-- Владелец: «добавь тренеров всех команд и их характера, а также анализ
-- положения их команд… историю противостояний стоит взять у тренеров, а не
-- команд, там больше пересечений. Характер тренера определяет характер
-- команды, но характеры тренеров меняются со временем».
--
-- ЧТО ИСТОЧНИК ДАЁТ. Страница клуба на Soccer Wiki несёт блок тренера: имя,
-- идентификатор, страну и портрет; страница тренера добавляет дату рождения.
-- Разбор и замеры — в docs/soccerwiki_managers.py.
--
-- ⚠️ ЧЕГО ИСТОЧНИК НЕ ДАЁТ ВОВСЕ, И ПОЧЕМУ ЭТО ЗАПИСАНО ЗДЕСЬ, А НЕ ЗАБЫТО:
--
--   ДОСТИЖЕНИЙ. Страница тренера — это имя, дата рождения, страна, текущий
--   клуб и флажок «Retired». Ни одного турнира. Поэтому колонки достижений
--   тут нет: пустая строка «трофеев нет» читается как «он ничего не выиграл»,
--   а значит «мы не знаем». Трофеи придётся брать из другого источника.
--
--   ИСТОРИИ НАЗНАЧЕНИЙ. Отдаётся ТОЛЬКО сегодняшний тренер. Значит «историю
--   противостояний тренеров», о которой просил владелец, задним числом
--   построить НЕЛЬЗЯ — её можно только накапливать, сравнивая сегодняшний
--   сбор с прошлым. Ровно для этого заведена `club_manager_spell`, и она
--   покрывает время С НАЧАЛА НАБЛЮДЕНИЯ. Выдать накопленное за карьеру
--   значило бы соврать: у Гвардиолы окажется «первый матч» в сентябре 2026.
--
--   ХАРАКТЕРА. Его нигде нет фактом. Владелец прав, что он меняется со
--   временем, — значит и считать его надо из игры команды под этим тренером
--   в скользящем окне, а не подписывать ярлык один раз. Для этого нужны
--   периоды из `club_manager_spell`, то есть сперва накопление.
--
-- ⚠️ `seen_since` — ЭТО НЕ ДАТА НАЗНАЧЕНИЯ. Это день, когда мы впервые
-- увидели тренера в этом клубе. Разница принципиальная, и экран обязан её
-- соблюдать: подпись «в клубе с» рядом с днём первого сбора — вранье числом.

create table if not exists public.club_manager (
  club_key    text primary key references public.football_club(club_key) on delete cascade,
  sw_mid      integer,
  name        text not null,
  country     text,
  born_on     date,
  photo_url   text,
  seen_since  date not null default current_date,
  fetched_at  timestamptz not null default now()
);

create table if not exists public.club_manager_spell (
  club_key   text not null references public.football_club(club_key) on delete cascade,
  sw_mid     integer,
  name       text not null,
  from_on    date not null,
  to_on      date,
  primary key (club_key, name, from_on)
);

create index if not exists club_manager_spell_mid_idx on public.club_manager_spell (sw_mid);
create index if not exists club_manager_name_idx on public.club_manager (name);

comment on table public.club_manager is
  'Текущий тренер клуба по Soccer Wiki. Источник отдаёт только сегодняшнего — истории назначений там нет, поэтому она накапливается в club_manager_spell с первого сбора.';
comment on table public.club_manager_spell is
  'Кто и когда вёл клуб. ⚠️ ТОЛЬКО С НАЧАЛА НАБЛЮДЕНИЯ: Soccer Wiki не отдаёт прошлых тренеров, и выдавать накопленное за полную карьеру нельзя.';

alter table public.club_manager enable row level security;
alter table public.club_manager_spell enable row level security;
drop policy if exists club_manager_read on public.club_manager;
create policy club_manager_read on public.club_manager for select to anon, authenticated using (true);
drop policy if exists club_manager_spell_read on public.club_manager_spell;
create policy club_manager_spell_read on public.club_manager_spell for select to anon, authenticated using (true);

grant select on public.club_manager, public.club_manager_spell to anon, authenticated;
grant select, insert, update, delete on public.club_manager, public.club_manager_spell to service_role;

-- Запись тренера: обновляет текущего И ведёт историю, когда тренер сменился.
create or replace function public.apply_club_manager(
  p_club_key text, p_sw_mid integer, p_name text,
  p_country text default null, p_born_on date default null, p_photo_url text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v_prev text; v_prev_from date;
begin
  if p_club_key is null or coalesce(btrim(p_name),'') = '' then return 'пусто'; end if;
  if not exists (select 1 from football_club f where f.club_key = p_club_key) then return 'нет клуба'; end if;

  select name, seen_since into v_prev, v_prev_from from club_manager where club_key = p_club_key;

  if v_prev is not null and v_prev <> p_name then
    -- Смена. Прошлый период закрывается вчерашним днём: точной даты источник
    -- не даёт, и «не позже сегодня» — всё, что мы знаем.
    update club_manager_spell set to_on = current_date - 1
      where club_key = p_club_key and name = v_prev and to_on is null;
  end if;

  insert into club_manager (club_key, sw_mid, name, country, born_on, photo_url, seen_since, fetched_at)
  values (p_club_key, p_sw_mid, p_name, p_country, p_born_on, p_photo_url, current_date, now())
  on conflict (club_key) do update set
    sw_mid = excluded.sw_mid, name = excluded.name,
    country = coalesce(excluded.country, club_manager.country),
    born_on = coalesce(excluded.born_on, club_manager.born_on),
    photo_url = coalesce(excluded.photo_url, club_manager.photo_url),
    seen_since = case when club_manager.name = excluded.name then club_manager.seen_since else current_date end,
    fetched_at = now();

  insert into club_manager_spell (club_key, sw_mid, name, from_on)
  values (p_club_key, p_sw_mid, p_name, coalesce(case when v_prev = p_name then v_prev_from end, current_date))
  on conflict (club_key, name, from_on) do nothing;

  return case when v_prev is null then 'новый' when v_prev = p_name then 'тот же' else 'сменился' end;
end;
$$;

revoke all on function public.apply_club_manager(text,integer,text,text,date,text) from public, anon, authenticated;
grant execute on function public.apply_club_manager(text,integer,text,text,date,text) to service_role;

-- ⚠️ DROP ПЕРЕД CREATE: в `returns table` добавились колонки тренера, а на это
-- Postgres отвечает «cannot change return type of existing function».
drop function if exists public.club_profile(text, text, integer);

create or replace function public.club_profile(p_club_key text, p_lang text default 'ru', p_days integer default 365)
returns table(club_key text, name text, name_en text, card_id uuid, country text, league text,
  crest_url text, kind text, squad integer, matches integer, wins integer, draws integer,
  losses integer, goals_for integer, goals_against integer, first_match date, last_match date,
  fetched_at timestamptz, elo integer, level smallint, league_weight numeric,
  league_place integer, league_size integer, market_value_eur bigint, market_value_priced integer,
  manager text, manager_country text, manager_born_on date, manager_photo text,
  manager_seen_since date)
language sql stable security definer set search_path = public
as $$
  with f as (select * from football_club where club_key = p_club_key),
  played as (
    select m.match_date,
           case when m.home_key = p_club_key then m.home_score else m.away_score end as gf,
           case when m.home_key = p_club_key then m.away_score else m.home_score end as ga
      from club_match m
     where (m.home_key = p_club_key or m.away_key = p_club_key)
       and m.match_date >= current_date - greatest(coalesce(p_days, 365), 1)
       and m.home_score is not null and m.away_score is not null
  ),
  tbl as (select * from league_table((select league from f), p_lang)),
  mv as (select * from club_market_value(p_club_key))
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.name_en, f.card_id, f.country, f.league, f.crest_url, f.kind,
         (select count(*)::int from club_squad q where q.club_key = f.club_key and q.left_at is null),
         (select count(*)::int from played),
         (select count(*)::int from played where gf > ga),
         (select count(*)::int from played where gf = ga),
         (select count(*)::int from played where gf < ga),
         (select coalesce(sum(gf),0)::int from played),
         (select coalesce(sum(ga),0)::int from played),
         (select min(match_date) from played),
         (select max(match_date) from played),
         f.fetched_at,
         r.elo, r.level, r.league_weight,
         (select t.place from tbl t where t.club_key = f.club_key),
         nullif((select count(*)::int from tbl), 0),
         nullif((select total_eur from mv), 0),
         (select priced from mv),
         g.name, g.country, g.born_on, g.photo_url, g.seen_since
    from f
    left join club_rating r on r.club_key = f.club_key
    left join club_manager g on g.club_key = f.club_key
$$;

revoke all on function public.club_profile(text, text, integer) from public;
grant execute on function public.club_profile(text, text, integer) to anon, authenticated, service_role;
