begin;

delete from public.forecast_pick where model = 'fly';
delete from public.forecast_calibration where model = 'fly';

drop function if exists public.forecast_upcoming_v2(integer, text);
drop function if exists public.forecast_scoreboard();
drop function if exists public.forecast_upcoming(integer);

drop index if exists public.forecast_pick_hungry;
alter table public.forecast_pick drop constraint if exists forecast_pick_model_check;
alter table public.forecast_pick
  add constraint forecast_pick_model_check check (model in ('llm', 'own'));
alter table public.forecast_pick drop column if exists dopamine_at;

drop table if exists public.fly_state;

create function public.forecast_upcoming(p_limit integer default 20)
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
  perform public.require_pro();
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

revoke all on function public.forecast_upcoming(integer) from public;
grant execute on function public.forecast_upcoming(integer) to anon, authenticated, service_role;
revoke all on function public.forecast_upcoming_v2(integer, text) from public;
grant execute on function public.forecast_upcoming_v2(integer, text) to anon, authenticated, service_role;

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

commit;
