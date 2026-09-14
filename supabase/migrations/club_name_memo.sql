-- ============================================================================
-- ПАМЯТКА «ИМЯ КОМАНДЫ → club_key» И УРОВНИ СОСТАВОВ.
--
-- ЗАЧЕМ. Владелец: «загрузку предстоящих матчей и новостей в pro версии сделай
-- быстрее (сейчас очень медленно грузит, может есть снова где-то ошибка)».
-- Ошибка нашлась, и она одна на четыре функции.
--
-- ⚠️ ГЛАВНОЕ ЧИСЛО: 195 мс ИЗ 267 — ЭТО РАЗБОР ИМЁН, А НЕ ДАННЫЕ. Замер на
-- бою, по три прогона подряд:
--
--     top_fixtures('ru', 6)                267 … 325 мс
--       из них resolve_club_key × 400      195 … 203 мс   ← 73 %
--       из них club_display_name × 400       5 …  17 мс
--
-- То есть главная ждала не расписание и не составы, а перевод четырёхсот
-- строк «Real Madrid» в наш `club_key` — заново, при каждом открытии, у
-- каждого игрока. В pg_stat_statements за 631 боевой вызов top_fixtures
-- вышло 737 мс в среднем и 4 643 мс в худшем; первый (холодный) вызов в этой
-- сессии дал 2 669 мс при анонимном лимите в 3 секунды — то есть главная
-- была в одном шаге от «пусто».
--
-- ЧТО СДЕЛАНО. Имена команд берутся из `fixtures`, и их конечное число: 437
-- на всю таблицу. Ночью каждое разбирается один раз и кладётся в
-- `club_name_resolved`; функции читают памятку соединением.
--
-- ⚠️ `coalesce(памятка, resolve_club_key(...))`, А НЕ ПРОСТО ПАМЯТКА. Матч с
-- НОВЫМ названием команды обязан работать сразу, а не ждать ночи. Цена
-- промаха — один прежний разбор на имя, и только на новое имя.
--
-- ⚠️ ЗАСАДА, КОТОРОЙ СЕГОДНЯ НЕТ, НО КОТОРАЯ БУДЕТ. Если имя не разберётся
-- вовсе, в памятке появится строка с `club_key is null`, и `coalesce`
-- провалится в дорогой разбор на КАЖДОМ запросе — ровно для тех имён,
-- которые и так не работают. Сегодня таких нет (437 из 437 разобраны), и
-- поэтому проверка ниже не гипотетическая: она сторожит день, когда появятся.
--
-- ⚠️ MATERIALIZED ВЕЗДЕ ОСТАЁТСЯ. Без него планировщик встраивает CTE в оба
-- соединения и зовёт ЗАПАСНОЙ разбор построчно: замерено 4 745 мс против
-- 408 мс на `fixture_team_rating`, и следом анонимный statement_timeout.
--
-- Эта миграция ЗАПИСЫВАЕТ уже применённое к бою (таблицы, пересборки,
-- расписание, переписанный fixture_team_rating) и ДОБАВЛЯЕТ то же лечение
-- двум функциям, которые назвал владелец: top_fixtures («предстоящие матчи»
-- на главной) и fixture_clubs (клубы в списке матчей).
-- ============================================================================

-- ── 1) Памятка имён ─────────────────────────────────────────────────────────

create table if not exists public.club_name_resolved (
  team        text primary key,
  club_key    text,
  resolved_at timestamptz not null default now()
);

comment on table public.club_name_resolved is
  'Имя команды из fixtures → club_key, разобранное один раз за ночь. '
  'Читается соединением; промах падает обратно на resolve_club_key.';

alter table public.club_name_resolved enable row level security;
drop policy if exists club_name_resolved_read on public.club_name_resolved;
create policy club_name_resolved_read on public.club_name_resolved for select using (true);
grant select on public.club_name_resolved to anon, authenticated, service_role;

create or replace function public.rebuild_club_name_resolved()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  -- Словарь псевдонимов пересобирается ночью, значит и памятка целиком: иначе
  -- вчерашний неверный ключ пережил бы починку псевдонима.
  delete from club_name_resolved;

  insert into club_name_resolved (team, club_key)
  select t.team, resolve_club_key(t.team, null)
    from (
      select home_team as team from fixtures
      union
      select away_team from fixtures
    ) t
   where t.team is not null and btrim(t.team) <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_club_name_resolved() from public;
grant execute on function public.rebuild_club_name_resolved() to service_role;

-- ── 2) Уровни составов ──────────────────────────────────────────────────────
-- Та же болезнь с другой стороны: `fixture_team_rating` считала оконную
-- функцию по всем 24 тысячам строк состава на каждый вызов. Глубже одиннадцати
-- не смотрит никто (depth ограничен сверху одиннадцатью), поэтому хранится
-- ровно одиннадцать лучших на клуб.

create table if not exists public.club_squad_level (
  club_key   text     not null,
  rn         smallint not null,
  level      smallint not null,
  squad_size smallint not null,
  primary key (club_key, rn)
);

comment on table public.club_squad_level is
  'Одиннадцать лучших игроков клуба по player_level, пересобирается ночью. '
  'squad_size — ВЕСЬ состав, а не одиннадцать: это разные числа.';

alter table public.club_squad_level enable row level security;
drop policy if exists club_squad_level_read on public.club_squad_level;
create policy club_squad_level_read on public.club_squad_level for select using (true);
grant select on public.club_squad_level to anon, authenticated, service_role;

create or replace function public.rebuild_club_squad_levels()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  -- Две отдельные команды, а не data-modifying CTE: все CTE делят один снимок,
  -- и delete внутри insert конфликтовал бы сам с собой.
  delete from club_squad_level;

  insert into club_squad_level (club_key, rn, level, squad_size)
  select r.club_key, r.rn::smallint, r.level::smallint, r.n::smallint
    from (
      select q.club_key, l.level,
             row_number() over (partition by q.club_key order by l.level desc) as rn,
             count(*)     over (partition by q.club_key)                        as n
        from club_squad q
        join player_level l on l.card_id = q.card_id
        join cards c on c.id = q.card_id and c.active and c.category = 'player'
       where q.left_at is null
    ) r
   -- Глубже одиннадцати не считается никогда: depth ограничен сверху 11.
   where r.rn <= 11;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_club_squad_levels() from public;
grant execute on function public.rebuild_club_squad_levels() to service_role;

-- ── 3) Расписание ───────────────────────────────────────────────────────────
-- ⚠️ ПОРЯДОК ВНУТРИ ЧАСА ЗНАЧИМ. Памятка имён обязана пересобираться ПОСЛЕ
-- словаря клубов (`rebuild-football-clubs`, 06:25), иначе она запомнит ключи,
-- разобранные вчерашним словарём. Составы — после памятки.
select cron.schedule('rebuild-club-name-resolved', '30 6 * * *',
                     $$select public.rebuild_club_name_resolved()$$);
select cron.schedule('rebuild-club-squad-levels',  '42 6 * * *',
                     $$select public.rebuild_club_squad_levels()$$);

-- ── 4) fixture_team_rating: памятка вместо разбора и оконной функции ────────
-- Замер до/после на бою: 400 мс → 38 мс, те же 166 строк.
--
-- ⚠️ ЭТОЙ ФУНКЦИИ НЕ ЗОВЁТ НИ ОДИН ЭКРАН — только её собственные тесты и
-- check-prod. Записано честно, чтобы следующий не принял её ускорение за
-- ускорение приложения: я сам сначала принял.

create or replace function public.fixture_team_rating(p_min_depth int default 5)
returns table (
  fixture_id       text,
  home_squad_level numeric,
  away_squad_level numeric,
  home_form_level  smallint,
  away_form_level  smallint,
  home_rating      numeric,
  away_rating      numeric,
  basis            text,
  depth            int,
  home_squad       int,
  away_squad       int,
  min_league_weight numeric
)
language sql stable security definer set search_path = public as $$
  -- ⚠️ КЛЮЧ КЛУБА БЕРЁТСЯ ИЗ ПАМЯТКИ, А НЕ РАЗБИРАЕТСЯ ЗАНОВО. План назвал это
  -- одной строкой: `CTE fx ... actual time=5.500..301.708` — 302 мс из 340 на
  -- 582 вызова resolve_club_key.
  with fx as materialized (
    select f.id,
           coalesce(mh.club_key, resolve_club_key(f.home_team, null)) as hk,
           coalesce(ma.club_key, resolve_club_key(f.away_team, null)) as ak
      from fixtures f
      left join club_name_resolved mh on mh.team = f.home_team
      left join club_name_resolved ma on ma.team = f.away_team
     where f.commence_at >= now() and not f.completed
  ),
  sz as (
    select club_key, max(squad_size)::int as n from club_squad_level group by club_key
  ),
  sized as (
    select fx.id, fx.hk, fx.ak, hz.n as hn, az.n as an,
           least(hz.n, az.n, 11) as depth
      from fx
      join sz hz on hz.club_key = fx.hk
      join sz az on az.club_key = fx.ak
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  ),
  squad as (
    select s.id, s.depth, s.hn, s.an, s.hk, s.ak,
           round(avg(ph.level)::numeric, 1) as hl,
           round(avg(pa.level)::numeric, 1) as al
      from sized s
      join club_squad_level ph on ph.club_key = s.hk and ph.rn <= s.depth
      join club_squad_level pa on pa.club_key = s.ak and pa.rn <= s.depth
     group by s.id, s.depth, s.hn, s.an, s.hk, s.ak
  )
  select q.id, q.hl, q.al,
         hr.level, ar.level,
         case when hr.level is null then q.hl else round((q.hl + hr.level) / 2.0, 1) end,
         case when ar.level is null then q.al else round((q.al + ar.level) / 2.0, 1) end,
         case when hr.level is null or ar.level is null then 'squad' else 'squad+form' end,
         q.depth, q.hn, q.an,
         least(coalesce(hr.league_weight, 1), coalesce(ar.league_weight, 1))
    from squad q
    left join club_rating hr on hr.club_key = q.hk
    left join club_rating ar on ar.club_key = q.ak
$$;

revoke all on function public.fixture_team_rating(int) from public;
grant execute on function public.fixture_team_rating(int) to anon, authenticated, service_role;

-- ── 5) top_fixtures: то же лечение «предстоящим матчам» на главной ──────────
-- ЕДИНСТВЕННОЕ ИЗМЕНЕНИЕ — соединение с памяткой в CTE `soon`. Отбор,
-- корзины, порядок и подписи прежние: см. top_fixtures_soon.sql, там же
-- объяснено, почему турнир берётся из матча, а не из лиги хозяев.

create or replace function public.top_fixtures(
  p_lang       text    default 'ru',
  p_limit      integer default 5,
  p_days         integer default 10,
  p_soon_hours   integer default 24,
  p_alert_minutes integer default 30)
returns table(
  fixture_id       text,
  commence_at      timestamptz,
  sport_key        text,
  league           text,
  home_key         text,
  home_name        text,
  home_crest       text,
  home_value       bigint,
  home_squad       integer,
  away_key         text,
  away_name        text,
  away_crest       text,
  away_value       bigint,
  away_squad       integer,
  importance       bigint,
  minutes_to_start integer)
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $function$
  with squad as materialized (
    select cc.club_key,
           sum(c.market_value_eur)::bigint as value,
           count(*) filter (where c.market_value_eur is not null)::integer as priced
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  ),
  -- ⚠️ ЗДЕСЬ БЫЛО 195 мс ИЗ 267. Четыреста имён команд разбирались заново на
  -- каждое открытие главной; теперь берутся из ночной памятки, а разбор
  -- остаётся запасным путём для названия, которого памятка ещё не видела.
  soon as materialized (
    select f.id, f.commence_at, f.sport_key,
           coalesce(mh.club_key, resolve_club_key(f.home_team, null)) as hk,
           coalesce(ma.club_key, resolve_club_key(f.away_team, null)) as ak
      from fixtures f
      left join club_name_resolved mh on mh.team = f.home_team
      left join club_name_resolved ma on ma.team = f.away_team
     where f.commence_at > now()
       and f.commence_at < now() + make_interval(days => greatest(coalesce(p_days, 10), 1))
       and not coalesce(f.completed, false)
  ),
  ranked as materialized (
    select s.id, s.commence_at,
           -- ⚠️ ТУРНИР — ИЗ САМОГО МАТЧА, А НЕ ИЗ ЛИГИ ХОЗЯЕВ: в еврокубках
           -- домашняя лига клуба и турнир матча расходятся всегда.
           s.sport_key,
           coalesce(hc.league, ac.league) as league,
           s.hk, club_display_name(s.hk, p_lang) as home_name, hc.crest_url as home_crest,
           hs.value as home_value, coalesce(hs.priced, 0) as home_squad,
           s.ak, club_display_name(s.ak, p_lang) as away_name, ac.crest_url as away_crest,
           as_.value as away_value, coalesce(as_.priced, 0) as away_squad,
           (coalesce(hs.value, 0) + coalesce(as_.value, 0))::bigint as importance,
           (extract(epoch from (s.commence_at - now())) / 60)::integer as mins,
           case
             when s.commence_at < now() + make_interval(mins => greatest(coalesce(p_alert_minutes, 30), 1))
               then 0
             when s.commence_at < now() + make_interval(hours => greatest(coalesce(p_soon_hours, 24), 1))
               then 1
             else 2
           end as bucket
      from soon s
      left join football_club hc on hc.club_key = s.hk
      left join football_club ac on ac.club_key = s.ak
      left join squad hs on hs.club_key = s.hk
      left join squad as_ on as_.club_key = s.ak
     where s.hk is not null and s.ak is not null
       and hc.crest_url is not null and ac.crest_url is not null
       and coalesce(hs.value, 0) + coalesce(as_.value, 0) > 0
  )
  select fixture_id, commence_at, sport_key, league,
         home_key, home_name, home_crest, home_value, home_squad,
         away_key, away_name, away_crest, away_value, away_squad,
         importance, mins
    from (
      select r.id as fixture_id, r.commence_at, r.sport_key, r.league,
             r.hk as home_key, r.home_name, r.home_crest, r.home_value, r.home_squad,
             r.ak as away_key, r.away_name, r.away_crest, r.away_value, r.away_squad,
             r.importance, r.mins, r.bucket
        from ranked r
    ) q
   order by q.bucket asc,
            -- Внутри корзины анонса — по времени: тот, что вот-вот начнётся,
            -- обязан быть первым, иначе анонс опоздает.
            case when q.bucket = 0 then q.mins end asc nulls last,
            q.importance desc,
            q.commence_at
   limit greatest(coalesce(p_limit, 5), 1);
$function$;

revoke all on function public.top_fixtures(text, integer, integer, integer, integer) from public;
grant execute on function public.top_fixtures(text, integer, integer, integer, integer)
  to anon, authenticated, service_role;

-- ── 6) fixture_clubs: то же лечение списку матчей ───────────────────────────
-- ЕДИНСТВЕННОЕ ИЗМЕНЕНИЕ — соединение с памяткой в CTE `want`.

create or replace function public.fixture_clubs(p_ids text[], p_lang text default 'ru')
returns table(
  fixture_id       text,
  home_key         text,
  home_name        text,
  home_crest       text,
  home_value       bigint,
  home_squad       integer,
  away_key         text,
  away_name        text,
  away_crest       text,
  away_value       bigint,
  away_squad       integer,
  minutes_to_start integer
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '20s'
as $$
  -- ⚠️ ВТОРОЙ КОПИИ ПРАВИЛА СОПОСТАВЛЕНИЯ ЗДЕСЬ НЕТ. Имя команды превращает в
  -- club_key ровно тот же путь, что и в top_fixtures: сперва ночная памятка,
  -- при промахе — та же resolve_club_key. Иначе «Зенит» на главной и «Зенит»
  -- в списке матчей разошлись бы молча.
  with want as materialized (
    select f.id, f.commence_at,
           coalesce(mh.club_key, resolve_club_key(f.home_team, null)) as hk,
           coalesce(ma.club_key, resolve_club_key(f.away_team, null)) as ak
      from fixtures f
      left join club_name_resolved mh on mh.team = f.home_team
      left join club_name_resolved ma on ma.team = f.away_team
     where f.id = any(coalesce(p_ids, '{}'::text[]))
  ),
  keys as materialized (
    select w.hk as k from want w where w.hk is not null
    union
    select w.ak from want w where w.ak is not null
  ),
  -- ⚠️ СОЕДИНЕНИЕ ПО СПИСКУ КЛЮЧЕЙ, А НЕ `club_key in (подзапрос)`. Разница
  -- измерена на тех же 120 матчах: соединение — 210 мс на всю функцию, `in`
  -- с подзапросом — 2 179 мс.
  --
  -- ⚠️ size — ВЕСЬ СОСТАВ, а value — только те, у кого есть цена.
  squad as materialized (
    select cc.club_key,
           sum(c.market_value_eur)::bigint as value,
           count(*)::integer as size
      from card_current_club cc
      join keys k on k.k = cc.club_key
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  )
  select w.id,
         w.hk,
         case when w.hk is null then null else club_display_name(w.hk, p_lang) end,
         hc.crest_url, hs.value, coalesce(hs.size, 0),
         w.ak,
         case when w.ak is null then null else club_display_name(w.ak, p_lang) end,
         ac.crest_url, as_.value, coalesce(as_.size, 0),
         -- Минуты до начала считает БАЗА: часы телефона врут молча.
         (extract(epoch from (w.commence_at - now())) / 60)::integer
    from want w
    left join football_club hc on hc.club_key = w.hk
    left join football_club ac on ac.club_key = w.ak
    left join squad hs on hs.club_key = w.hk
    left join squad as_ on as_.club_key = w.ak;
$$;

revoke all on function public.fixture_clubs(text[], text) from public;
grant execute on function public.fixture_clubs(text[], text) to anon, authenticated, service_role;
