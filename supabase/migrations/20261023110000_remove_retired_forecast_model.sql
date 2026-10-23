begin;

delete from public.forecast_pick where model = 'fly';
delete from public.forecast_calibration where model = 'fly';

delete from public.accumulator_leg
 where ticket_id in (select id from public.accumulator_ticket where model = 'fly');
delete from public.accumulator_ticket where model = 'fly';

drop function if exists public.forecast_upcoming_v2(integer, text);
drop function if exists public.forecast_scoreboard();
drop function if exists public.forecast_upcoming(integer);
drop function if exists public.forecast_upcoming(integer, text);

drop index if exists public.forecast_pick_hungry;
alter table public.forecast_pick drop constraint if exists forecast_pick_model_check;
alter table public.forecast_pick
  add constraint forecast_pick_model_check check (model in ('llm', 'own'));
alter table public.forecast_pick drop column if exists dopamine_at;

drop table if exists public.fly_state;
drop function if exists public.forecast_starving();

create function public.forecast_upcoming(
  p_limit integer default 20,
  p_password text default null
)
returns table (
  fixture_id text,
  commence_at timestamptz,
  home_team text,
  away_team text,
  llm_pick text,
  llm_conf numeric,
  own_pick text,
  own_conf numeric,
  exp_total numeric,
  agree integer
)
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '4s'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and
     (p_password is null or not public.admin_check_password(p_password)) then
    perform public.require_pro();
  end if;
  return query
    select p.fixture_id, min(p.commence_at), min(p.home_team), min(p.away_team),
           max(p.pick) filter (where p.model = 'llm'),
           max(p.confidence) filter (where p.model = 'llm'),
           max(p.pick) filter (where p.model = 'own'),
           max(p.confidence) filter (where p.model = 'own'),
           round(avg(p.exp_total), 1),
           (select max(c)::integer from (
              select count(*) as c
                from public.forecast_pick q
               where q.fixture_id = p.fixture_id
               group by q.pick
           ) z)
      from public.forecast_pick p
     where p.commence_at > now()
       and p.model in ('llm', 'own')
     group by p.fixture_id
     order by min(p.commence_at)
     limit greatest(1, least(coalesce(p_limit, 20), 60));
end;
$function$;

create function public.forecast_upcoming_v2(
  p_limit integer default 20,
  p_password text default null
)
returns table (
  fixture_id text,
  commence_at timestamptz,
  home_team text,
  away_team text,
  llm_pick text,
  llm_conf numeric,
  own_pick text,
  own_conf numeric,
  exp_total numeric,
  agree integer,
  llm_cal numeric,
  own_cal numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '4s'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and
     (p_password is null or not public.admin_check_password(p_password)) then
    perform public.require_pro();
  end if;

  return query
    with p as (
      select k.fixture_id, k.commence_at, k.home_team, k.away_team,
             max(case when k.model = 'llm' then k.pick end) as llm_pick,
             max(case when k.model = 'llm' then k.confidence end) as llm_conf,
             max(case when k.model = 'own' then k.pick end) as own_pick,
             max(case when k.model = 'own' then k.confidence end) as own_conf,
             max(k.exp_total) as exp_total,
             count(*) filter (where k.pick = (
               select mode() within group (order by k2.pick)
                 from public.forecast_pick k2
                where k2.fixture_id = k.fixture_id
                  and k2.model in ('llm', 'own')
             ))::integer as agree
        from public.forecast_pick k
       where k.commence_at > now()
         and k.model in ('llm', 'own')
       group by k.fixture_id, k.commence_at, k.home_team, k.away_team
    )
    select p.fixture_id, p.commence_at, p.home_team, p.away_team,
           p.llm_pick, p.llm_conf, p.own_pick, p.own_conf, p.exp_total, p.agree,
           public.calibrated_confidence(p.llm_conf, 'llm'),
           public.calibrated_confidence(p.own_conf, 'own')
      from p
     order by p.commence_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

revoke all on function public.forecast_upcoming(integer, text) from public;
grant execute on function public.forecast_upcoming(integer, text) to anon, authenticated, service_role;
revoke all on function public.forecast_upcoming_v2(integer, text) from public;
grant execute on function public.forecast_upcoming_v2(integer, text) to anon, authenticated, service_role;

drop function if exists public.forecast_history(text, integer, timestamptz, text, text);
drop function if exists public.forecast_history(text, integer);
create function public.forecast_history(
  p_model text default null,
  p_limit integer default 40
)
returns table (
  fixture_id text,
  commence_at timestamptz,
  home_team text,
  away_team text,
  model text,
  pick text,
  confidence numeric,
  actual text,
  correct boolean,
  actual_total numeric,
  exp_total numeric,
  backfilled boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '4s'
as $function$
begin
  perform public.require_pro();
  return query
    select p.fixture_id, p.commence_at, p.home_team, p.away_team, p.model,
           p.pick, p.confidence, p.actual, p.correct, p.actual_total,
           p.exp_total, p.backfilled
      from public.forecast_pick p
     where p.correct is not null
       and (p_model is null or p.model = p_model)
     order by p.commence_at desc
     limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$function$;

revoke all on function public.forecast_history(text, integer) from public;
grant execute on function public.forecast_history(text, integer) to anon, authenticated, service_role;

drop function if exists public.build_model_accumulators(integer, integer[], numeric);

create function public.build_model_accumulators(
  p_days  integer default 14,
  p_legs  integer[] default array[3, 4],
  p_floor numeric default 0.47
)
returns text
language plpgsql security definer set search_path = public as $build_model$
declare
  v_model text;
  v_k     int;
  v_day   date;
  v_rule  text;
  v_id    bigint;
  v_prob  numeric;
  v_made  int := 0;
  v_skip  int := 0;
  v_thin  int := 0;
begin
  create temp table if not exists _legs_tmp (
    fixture_id text, pick text, prob numeric,
    home_team text, away_team text, commence_at timestamptz
  ) on commit drop;

  for v_day in
    select distinct (p.commence_at at time zone 'utc')::date
      from forecast_pick p
     where p.commence_at > now()
       and p.commence_at < now() + make_interval(days => greatest(1, p_days))
     order by 1
  loop
    foreach v_k in array p_legs loop
      foreach v_model in array array['llm', 'own'] loop
        v_rule := 'model:' || v_model || ':' || v_k;

        if exists (select 1 from accumulator_ticket t
                    where t.rule = v_rule and t.match_day = v_day) then
          v_skip := v_skip + 1;
          continue;
        end if;

        delete from _legs_tmp;

        -- ⚠️ ПРАВИЛО ОТБОРА, ВЫБРАННОЕ ЗАМЕРОМ: СОГЛАСИЕ ОБЕИХ АКТИВНЫХ МОДЕЛЕЙ, порог
        -- 0.47 по калиброванной вероятности, потом лучшие по вероятности
        -- ЭТОЙ модели. Числа и оговорка про значимость — в шапке файла.
        --
        -- ⚠️ ПОРОГ ЗДЕСЬ НЕ ДЛЯ КРАСОТЫ: он отсекает дни, когда сильных плеч
        -- вместо 150 — тридцать дней остались БЕЗ экспресса, и это правильный
        -- исход: доля проходов при этом выросла с 18.0 % до 18.3 %.
        insert into _legs_tmp
        select p.fixture_id, p.pick,
               calibrated_confidence(p.confidence, p.model),
               p.home_team, p.away_team, p.commence_at
          from forecast_pick p
         where p.model = v_model
           and p.commence_at > now()
           and (p.commence_at at time zone 'utc')::date = v_day
           and (select count(distinct p2.pick) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                    and p2.model in ('llm', 'own')) = 1
           and (select count(*) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                   and p2.model in ('llm', 'own')) = 2
           and calibrated_confidence(p.confidence, p.model) >= coalesce(p_floor, 0.47)
         -- ⚠️ ДОБОР ПО commence_at И fixture_id ОБЯЗАТЕЛЕН, и это видно на
         -- живых данных: у `own` калибровка сжала почти всё к 0.5500, то есть
         -- равенства сплошные. Без полного добора два прогона собрали бы
         -- РАЗНЫЕ билеты из одних и тех же данных.
         order by calibrated_confidence(p.confidence, p.model) desc,
                  p.commence_at asc, p.fixture_id asc
         limit v_k;

        if (select count(*) from _legs_tmp) < v_k then
          v_thin := v_thin + 1;
          continue;
        end if;

        select exp(sum(ln(greatest(prob, 0.0001)))) into v_prob from _legs_tmp;

        insert into accumulator_ticket
              (rule, model, legs, pass_prob, payout, match_day)
        values (v_rule, v_model, v_k, round(v_prob, 4), null, v_day)
        returning id into v_id;

        insert into accumulator_leg
              (ticket_id, fixture_id, pick, price, fair_prob,
               home_team, away_team, commence_at)
        select v_id, fixture_id, pick, null, round(prob, 4),
               home_team, away_team, commence_at
          from _legs_tmp;

        v_made := v_made + 1;
      end loop;
    end loop;
  end loop;

  return format('экспрессов собрано: %s, уже были: %s, не хватило плеч: %s',
                v_made, v_skip, v_thin);
end;
$build_model$;

revoke all on function public.build_model_accumulators(integer, integer[], numeric) from public;
grant execute on function public.build_model_accumulators(integer, integer[], numeric) to service_role;

create or replace function public.backfill_model_accumulators(p_floor numeric default 0.47)
returns text
language plpgsql security definer set search_path = public as $backfill_model$
declare
  v_model text;
  v_k     int;
  v_day   date;
  v_rule  text;
  v_id    bigint;
  v_prob  numeric;
  v_made  int := 0;
  v_thin  int := 0;
begin
  create temp table if not exists _bf_tmp (
    fixture_id text, pick text, prob numeric, correct boolean,
    home_team text, away_team text, commence_at timestamptz
  ) on commit drop;

  for v_day in
    select distinct (p.commence_at at time zone 'utc')::date
      from forecast_pick p
     where p.correct is not null
     order by 1
  loop
    foreach v_k in array array[3, 4] loop
      foreach v_model in array array['llm', 'own'] loop
        v_rule := 'model:' || v_model || ':' || v_k;

        if exists (select 1 from accumulator_ticket t
                    where t.rule = v_rule and t.match_day = v_day) then
          continue;
        end if;

        delete from _bf_tmp;

        insert into _bf_tmp
        select p.fixture_id, p.pick,
               calibrated_confidence(p.confidence, p.model), p.correct,
               p.home_team, p.away_team, p.commence_at
          from forecast_pick p
         where p.model = v_model
           and p.correct is not null
           and (p.commence_at at time zone 'utc')::date = v_day
           and (select count(distinct p2.pick) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                    and p2.model in ('llm', 'own')) = 1
           and (select count(*) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                   and p2.model in ('llm', 'own')) = 2
           and calibrated_confidence(p.confidence, p.model) >= coalesce(p_floor, 0.47)
         order by calibrated_confidence(p.confidence, p.model) desc,
                  p.commence_at asc, p.fixture_id asc
         limit v_k;

        if (select count(*) from _bf_tmp) < v_k then
          v_thin := v_thin + 1;
          continue;
        end if;

        select exp(sum(ln(greatest(prob, 0.0001)))) into v_prob from _bf_tmp;

        insert into accumulator_ticket
              (rule, model, legs, pass_prob, payout, match_day, backfilled,
               placed_at, settled_at, won, legs_won)
        select v_rule, v_model, v_k, round(v_prob, 4), null, v_day, true,
               v_day::timestamptz, v_day::timestamptz + interval '1 day',
               bool_and(correct),
               count(*) filter (where correct)::smallint
          from _bf_tmp
        returning id into v_id;

        insert into accumulator_leg
              (ticket_id, fixture_id, pick, price, fair_prob,
               home_team, away_team, commence_at, correct)
        select v_id, fixture_id, pick, null, round(prob, 4),
               home_team, away_team, commence_at, correct
          from _bf_tmp;

        v_made := v_made + 1;
      end loop;
    end loop;
  end loop;

  return format('задним числом собрано: %s, не хватило плеч: %s', v_made, v_thin);
end;
$backfill_model$;

revoke all on function public.backfill_model_accumulators(numeric) from public;
grant execute on function public.backfill_model_accumulators(numeric) to service_role;

create function public.forecast_history(
  p_model text default null,
  p_limit integer default 40,
  p_before_at timestamptz default null,
  p_before_id text default null,
  p_password text default null
)
returns table (
  fixture_id text,
  commence_at timestamptz,
  home_team text,
  away_team text,
  model text,
  pick text,
  confidence numeric,
  actual text,
  correct boolean,
  actual_total numeric,
  exp_total numeric,
  backfilled boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '4s'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and
     (p_password is null or not public.admin_check_password(p_password)) then
    perform public.require_pro();
  end if;

  return query
    select p.fixture_id, p.commence_at, p.home_team, p.away_team, p.model,
           p.pick, p.confidence, p.actual, p.correct, p.actual_total,
           p.exp_total, p.backfilled
      from public.forecast_pick p
     where p.correct is not null
       and (p_model is null or p.model = p_model)
       and (p_before_at is null or p_before_id is null
            or (p.commence_at, p.fixture_id) < (p_before_at, p_before_id))
     order by p.commence_at desc, p.fixture_id desc
     limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$function$;

revoke all on function public.forecast_history(text, integer, timestamptz, text, text) from public;
grant execute on function public.forecast_history(text, integer, timestamptz, text, text) to anon, authenticated, service_role;

commit;
