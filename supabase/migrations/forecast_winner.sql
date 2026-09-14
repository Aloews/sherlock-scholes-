-- ============================================================================
-- КТО ПОБЕДИТ: три прогнозиста, их история и память мухи.
--
-- Владелец: «в ближайших матчах помимо „характера матча“ давай прогнозы трёх
-- вариантов», «помимо голов указывать победителя», «точно сохранять историю
-- прогнозов, делать вывод и получать дофамин».
--
-- ⚠️ ПО ПУТИ НАШЛАСЬ УТЕЧКА, И ОНА БЫЛА В САМОЙ ВЫБОРКЕ. `duel_features`
-- соединялась со скользящим окном по (клуб, дата). Окно даёт строку на КАЖДЫЙ
-- матч; у клуба с двумя матчами в один день строк две — и матч умножался на
-- два, а после добавления домашней формы на четыре. Замер: 10 920 строк на
-- 4 517 настоящих матчей. Это не косметика: один и тот же матч попадал И в
-- обучающую часть, И в тестовую, то есть замер хвалил модель за игру, которую
-- она уже видела. Все прежние числа состязания получены на такой выборке.
--
-- ⚠️ И ЭТО НЕ ДУБЛИ В `club_match`: там 13 454 строки и ровно столько же
-- уникальных троек (дата, хозяева, гости). Двоятся КЛУБЫ — один и тот же матч
-- записан под разными написаниями команды («mainz» и «maynts»), и у клуба
-- выходит два матча в один день. Починка здесь — `distinct on`; сами
-- клубы-двойники остаются отдельной задачей.
--
-- ⚠️ ВЫБОРКА СТАЛА МАТЕРИАЛИЗОВАННОЙ. После снятия дублей PostgREST начал
-- отвечать 57014: `distinct on` поверх четырёх соединений не укладывается в
-- лимит. Обучающая выборка и не должна считаться на каждое чтение — она
-- меняется раз в сутки, когда приходят новые счета.
-- ============================================================================

-- ── 1. Выборка: без дублей, с формой ДОМА и В ГОСТЯХ ────────────────────────
-- ⚠️ ФОРМА ДОМА И В ГОСТЯХ ОТДЕЛЬНО — ЭТО ГЛАВНОЕ, ЧЕГО НЕ ХВАТАЛО. `h_gf` —
-- среднее по ВСЕМ матчам команды; команда, которая дома громит, а на выезде не
-- забивает, выглядит в нём «средней». Именно на этих колонках «свой вариант»
-- поднялся с 41.0 % до 46.2 %.
drop view if exists duel_features;
drop materialized view if exists duel_features;

create materialized view duel_features as
  with games as (
    select m.match_date, m.home_key, m.away_key,
           m.home_score::numeric as hs, m.away_score::numeric as as_,
           (m.home_score + m.away_score)::numeric as total
      from club_match m
     where m.home_score is not null and m.away_score is not null
       and m.home_key <> m.away_key
       and m.match_date >= current_date - 400
  ), uniq as (
    select distinct on (match_date, home_key, away_key) *
      from games order by match_date, home_key, away_key
  ), sides as (
    select match_date, home_key as club, true as at_home, hs as gf, as_ as ga,
           case when hs > as_ then 1.0 else 0.0 end as win,
           case when hs = as_ then 1.0 else 0.0 end as draw
      from uniq
    union all
    select match_date, away_key, false, as_, hs,
           case when as_ > hs then 1.0 else 0.0 end,
           case when hs = as_ then 1.0 else 0.0 end
      from uniq
  ), roll as (
    select distinct on (club, match_date) * from (
      select club, match_date,
             avg(gf) over w as gf_pm, avg(ga) over w as ga_pm,
             count(*) over w as n, stddev_samp(gf + ga) over w as sd,
             avg(win) over w as wr, avg(draw) over w as dr
        from sides
      window w as (partition by club order by match_date
                   range between '400 days'::interval preceding
                             and '1 day'::interval preceding)
    ) q order by club, match_date
  ), roll_venue as (
    select distinct on (club, at_home, match_date) * from (
      select club, at_home, match_date,
             avg(gf) over w as gf_pm, avg(ga) over w as ga_pm,
             count(*) over w as n, avg(win) over w as wr
        from sides
      window w as (partition by club, at_home order by match_date
                   range between '400 days'::interval preceding
                             and '1 day'::interval preceding)
    ) q order by club, at_home, match_date
  )
  select g.match_date, g.total, g.home_key, g.away_key,
         round(rh.gf_pm, 4) as h_gf, round(rh.ga_pm, 4) as h_ga,
         round(ra.gf_pm, 4) as a_gf, round(ra.ga_pm, 4) as a_ga,
         rh.n as h_n, ra.n as a_n,
         round(coalesce(rh.sd, 0::numeric), 4) as h_sd,
         round(coalesce(ra.sd, 0::numeric), 4) as a_sd,
         g.hs as home_score, g.as_ as away_score,
         case when g.hs > g.as_ then 'H'
              when g.hs < g.as_ then 'A' else 'D' end as outcome,
         round(rh.wr, 4) as h_wr, round(ra.wr, 4) as a_wr,
         round(rh.dr, 4) as h_dr, round(ra.dr, 4) as a_dr,
         round(vh.gf_pm, 4) as h_home_gf, round(vh.ga_pm, 4) as h_home_ga,
         round(vh.wr, 4)    as h_home_wr, vh.n as h_home_n,
         round(va.gf_pm, 4) as a_away_gf, round(va.ga_pm, 4) as a_away_ga,
         round(va.wr, 4)    as a_away_wr, va.n as a_away_n
    from uniq g
    join roll rh on rh.club = g.home_key and rh.match_date = g.match_date
    join roll ra on ra.club = g.away_key and ra.match_date = g.match_date
    join roll_venue vh on vh.club = g.home_key and vh.at_home
                      and vh.match_date = g.match_date
    join roll_venue va on va.club = g.away_key and not va.at_home
                      and va.match_date = g.match_date
   where rh.n >= 10 and ra.n >= 10 and vh.n >= 4 and va.n >= 4;

create unique index duel_features_pk on duel_features (match_date, home_key, away_key);
grant select on duel_features to service_role;

create or replace function rebuild_duel_features()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare v integer;
begin
  -- CONCURRENTLY, чтобы читающие не ждали; для этого и нужен уникальный индекс.
  refresh materialized view concurrently duel_features;
  select count(*) into v from duel_features;
  return v;
end;
$$;

-- ── 2. Форма клуба на сегодня — для БУДУЩИХ матчей ──────────────────────────
-- ⚠️ ОБЫЧНЫЕ АГРЕГАТЫ, А НЕ ОКНА, И ЭТО НЕ ЛЕНЬ. Для сыгранного матча форма
-- считается окном «за сутки до», иначе это утечка. Для будущего матча утечки
-- нет вовсе: всё сыгранное уже в прошлом, и нужен просто срез на сегодня.
drop materialized view if exists club_form;
create materialized view club_form as
  with games as (
    select distinct on (match_date, home_key, away_key)
           match_date, home_key, away_key,
           home_score::numeric as hs, away_score::numeric as as_
      from club_match
     where home_score is not null and away_score is not null
       and home_key <> away_key and match_date >= current_date - 400
     order by match_date, home_key, away_key
  ), sides as (
    select home_key as club, true as at_home, hs as gf, as_ as ga,
           case when hs > as_ then 1.0 else 0.0 end as win,
           case when hs = as_ then 1.0 else 0.0 end as draw
      from games
    union all
    select away_key, false, as_, hs,
           case when as_ > hs then 1.0 else 0.0 end,
           case when hs = as_ then 1.0 else 0.0 end
      from games
  )
  select s.club, count(*)::int as n,
         round(avg(s.gf), 4) as gf, round(avg(s.ga), 4) as ga,
         round(avg(s.win), 4) as wr, round(avg(s.draw), 4) as dr,
         round(coalesce(stddev_samp(s.gf + s.ga), 0), 4) as sd,
         count(*) filter (where s.at_home)::int as home_n,
         round(avg(s.gf)  filter (where s.at_home), 4) as home_gf,
         round(avg(s.ga)  filter (where s.at_home), 4) as home_ga,
         round(avg(s.win) filter (where s.at_home), 4) as home_wr,
         count(*) filter (where not s.at_home)::int as away_n,
         round(avg(s.gf)  filter (where not s.at_home), 4) as away_gf,
         round(avg(s.ga)  filter (where not s.at_home), 4) as away_ga,
         round(avg(s.win) filter (where not s.at_home), 4) as away_wr
    from sides s group by s.club;

create unique index club_form_pk on club_form (club);
grant select on club_form to service_role;

-- ⚠️ КЛЮЧ КЛУБА БЕРЁТСЯ ИЗ ПАМЯТКИ, А НЕ `resolve_club_key` НА КАЖДУЮ СТРОКУ:
-- промах памятки стоит анонимных трёх секунд, и проект уже получал на этом
-- 57014 (`club_name_memo.sql`).
create or replace view forecast_inputs as
  select f.id as fixture_id, f.commence_at, f.home_team, f.away_team,
         coalesce(mh.club_key, resolve_club_key(f.home_team, null)) as home_key,
         coalesce(ma.club_key, resolve_club_key(f.away_team, null)) as away_key,
         hf.gf as h_gf, hf.ga as h_ga, hf.wr as h_wr, hf.dr as h_dr,
         hf.sd as h_sd, hf.n as h_n,
         af.gf as a_gf, af.ga as a_ga, af.wr as a_wr, af.dr as a_dr,
         af.sd as a_sd, af.n as a_n,
         hf.home_gf as h_home_gf, hf.home_ga as h_home_ga,
         hf.home_wr as h_home_wr, hf.home_n as h_home_n,
         af.away_gf as a_away_gf, af.away_ga as a_away_ga,
         af.away_wr as a_away_wr, af.away_n as a_away_n
    from fixtures f
    left join club_name_resolved mh on mh.team = f.home_team
    left join club_name_resolved ma on ma.team = f.away_team
    join club_form hf on hf.club = coalesce(mh.club_key, resolve_club_key(f.home_team, null))
    join club_form af on af.club = coalesce(ma.club_key, resolve_club_key(f.away_team, null))
   where hf.n >= 10 and af.n >= 10 and hf.home_n >= 4 and af.away_n >= 4;

grant select on forecast_inputs to service_role;

-- ── 3. История прогнозов ────────────────────────────────────────────────────
-- ⚠️ ПРОГНОЗ ПИШЕТСЯ ДО МАТЧА И БОЛЬШЕ НЕ ПРАВИТСЯ. Иначе «история прогнозов»
-- превращается в историю объяснений задним числом: строку допишут после
-- результата, и она всегда будет выглядеть разумной.
create table if not exists forecast_pick (
  fixture_id   text        not null,
  model        text        not null check (model in ('llm', 'fly', 'own')),
  pick         text        not null check (pick in ('H', 'D', 'A')),
  confidence   numeric     not null default 0,
  exp_total    numeric,
  commence_at  timestamptz not null,
  home_team    text        not null,
  away_team    text        not null,
  made_at      timestamptz not null default now(),
  actual       text        check (actual in ('H', 'D', 'A')),
  actual_total numeric,
  correct      boolean,
  graded_at    timestamptz,
  -- ⚠️ ДОФАМИН ЗАПИСЫВАЕТСЯ ОТДЕЛЬНО ОТ «УГАДАЛ». Муха получает подкрепление на
  -- КАЖДЫЙ исход, а не только на угаданный: дофаминовый нейрон отвечает на
  -- событие, а не на правоту. Без этой колонки «обучение идёт» нечем
  -- подтвердить, и один матч подкреплялся бы каждую ночь заново.
  dopamine_at  timestamptz,
  -- Строка, сделанная задним числом на тестовой части. Утечки там нет, но
  -- «назвал до матча» и «назвал задним числом» — разные вещи.
  backfilled   boolean     not null default false,
  primary key (fixture_id, model)
);

create index if not exists forecast_pick_commence on forecast_pick (commence_at desc);
create index if not exists forecast_pick_ungraded on forecast_pick (commence_at)
  where correct is null;
create index if not exists forecast_pick_hungry on forecast_pick (graded_at)
  where dopamine_at is null;

alter table forecast_pick enable row level security;
grant select, insert, update on forecast_pick to service_role;

create table if not exists forecast_model (
  id text primary key default 'current',
  params jsonb not null,
  fitted_at timestamptz not null default now()
);
alter table forecast_model enable row level security;
grant select, insert, update on forecast_model to service_role;

-- ── 4. Память мухи ──────────────────────────────────────────────────────────
-- ⚠️ ХРАНЯТСЯ ТОЛЬКО СУЩЕСТВУЮЩИЕ СВЯЗИ. Матрица KC→MBON — 1927 × 68, но связей
-- в ней 30 496: остальное — нули, которых у мухи нет вовсе. Сохранять нули
-- значило бы позволить им однажды стать ненулями и завести синапс, которого в
-- мозге не существует. Порядок берётся из самого коннектома.
create table if not exists fly_state (
  id         text        primary key default 'mb',
  weights    real[]      not null,
  taught     integer     not null default 0,
  dopamine   integer     not null default 0,
  depression numeric     not null default 0.02,
  updated_at timestamptz not null default now()
);
alter table fly_state enable row level security;
grant select, insert, update on fly_state to service_role;

-- ── 5. Что видит приложение ─────────────────────────────────────────────────
-- ⚠️ ВСЕ ТРИ ЗА ВОРОТАМИ Pro. Экран прячется от неподписанного целиком, но
-- спрятанный экран НЕ ЗАКРЫВАЕТ ДАННЫЕ: кто откроет devtools, позовёт RPC
-- напрямую.
--
-- ⚠️ `require_pro()` ВОЗВРАЩАЕТ void И БРОСАЕТ, а не отдаёт «истину». Значит
-- функции обязаны быть plpgsql с `perform`: в `where require_pro()` СУБД
-- отвечает «argument of AND must be type boolean, not type void».
create or replace function forecast_upcoming(p_limit integer default 20)
returns table (fixture_id text, commence_at timestamptz,
               home_team text, away_team text,
               llm_pick text, llm_conf numeric,
               fly_pick text, fly_conf numeric,
               own_pick text, own_conf numeric,
               exp_total numeric, agree integer)
language plpgsql stable security definer
set search_path to 'public' set statement_timeout to '4s'
as $$
begin
  perform require_pro();
  return query
    select p.fixture_id, min(p.commence_at), min(p.home_team), min(p.away_team),
           max(p.pick)       filter (where p.model = 'llm'),
           max(p.confidence) filter (where p.model = 'llm'),
           max(p.pick)       filter (where p.model = 'fly'),
           max(p.confidence) filter (where p.model = 'fly'),
           max(p.pick)       filter (where p.model = 'own'),
           max(p.confidence) filter (where p.model = 'own'),
           round(avg(p.exp_total), 1),
           (select max(c)::int from (select count(*) as c from forecast_pick q
                                      where q.fixture_id = p.fixture_id
                                      group by q.pick) z)
      from forecast_pick p
     where p.commence_at > now()
     group by p.fixture_id
     order by min(p.commence_at)
     limit greatest(1, least(coalesce(p_limit, 20), 60));
end;
$$;

drop function if exists forecast_scoreboard();
create function forecast_scoreboard()
returns table (model text, graded integer, hits integer, accuracy numeric,
               last30 numeric, streak integer, dopamine integer,
               backfilled integer)
language plpgsql stable security definer
set search_path to 'public' set statement_timeout to '4s'
as $$
begin
  perform require_pro();
  return query
    with g as (
      select fp.model, fp.correct, fp.commence_at, fp.backfilled,
             row_number() over (partition by fp.model order by fp.commence_at desc) as rn
        from forecast_pick fp where fp.correct is not null
    ), base as (
      select g.model, count(*)::int as graded,
             count(*) filter (where g.correct)::int as hits,
             round(avg(case when g.correct then 1.0 else 0.0 end), 4) as accuracy,
             round(avg(case when g.correct then 1.0 else 0.0 end)
                   filter (where g.rn <= 30), 4) as last30,
             count(*) filter (where g.backfilled)::int as backfilled
        from g group by g.model
    ), run as (
      select q.model, count(*)::int as streak from (
        select g.model, g.correct,
               sum(case when g.correct then 0 else 1 end)
                 over (partition by g.model order by g.commence_at desc
                       rows between unbounded preceding and current row) as broke
          from g
      ) q where q.broke = 0 and q.correct group by q.model
    )
    select b.model, b.graded, b.hits, b.accuracy, b.last30,
           coalesce(r.streak, 0),
           coalesce((select f.dopamine from fly_state f where f.id = 'mb'), 0),
           b.backfilled
      from base b left join run r on r.model = b.model
     order by b.accuracy desc nulls last;
end;
$$;

drop function if exists forecast_history(text, integer);
create function forecast_history(p_model text default null,
                                 p_limit integer default 40)
returns table (fixture_id text, commence_at timestamptz,
               home_team text, away_team text, model text,
               pick text, confidence numeric, actual text, correct boolean,
               actual_total numeric, exp_total numeric, dopamine boolean,
               backfilled boolean)
language plpgsql stable security definer
set search_path to 'public' set statement_timeout to '4s'
as $$
begin
  perform require_pro();
  return query
    select p.fixture_id, p.commence_at, p.home_team, p.away_team, p.model,
           p.pick, p.confidence, p.actual, p.correct, p.actual_total,
           p.exp_total, p.dopamine_at is not null, p.backfilled
      from forecast_pick p
     where p.correct is not null
       and (p_model is null or p.model = p_model)
     order by p.commence_at desc
     limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

revoke execute on function forecast_upcoming(integer) from public;
revoke execute on function forecast_scoreboard() from public;
revoke execute on function forecast_history(text, integer) from public;
grant execute on function forecast_upcoming(integer)    to anon, authenticated, service_role;
grant execute on function forecast_scoreboard()          to anon, authenticated, service_role;
grant execute on function forecast_history(text, integer) to anon, authenticated, service_role;

-- ── 6. Ночное расписание ────────────────────────────────────────────────────
-- ⚠️ ПОРЯДОК НЕ УДОБСТВО: выборка пересобирается ПОСЛЕ матчей команд (06:25) и
-- ДО того, как питон пойдёт её читать.
select cron.schedule('rebuild-duel-features', '50 6 * * *',
                     $cron$select public.rebuild_duel_features();
                            refresh materialized view concurrently public.club_form;$cron$)
 where not exists (select 1 from cron.job where jobname = 'rebuild-duel-features');
