-- Forecast scoreboard and upcoming fixtures for active models.

create or replace function public.forecast_scoreboard(p_password text default null)
returns table(
  model text,
  graded integer,
  hits integer,
  accuracy numeric,
  last30 numeric,
  streak integer,
  backfilled integer
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
    with g as (
      select fp.model, fp.correct, fp.commence_at, fp.backfilled,
             row_number() over (partition by fp.model order by fp.commence_at desc) as rn
        from public.forecast_pick fp
       where fp.correct is not null
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
           coalesce(r.streak, 0), b.backfilled
      from base b left join run r on r.model = b.model
     order by b.accuracy desc nulls last;
end;
$function$;

create or replace function public.forecast_upcoming_v2(
  p_limit integer default 20,
  p_password text default null
)
returns table(
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
  own_cal numeric,
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
             ))::integer as agree
        from public.forecast_pick k
       where k.commence_at > now()
       group by k.fixture_id, k.commence_at, k.home_team, k.away_team
    )
    select p.fixture_id, p.commence_at, p.home_team, p.away_team,
           p.llm_pick, p.llm_conf, p.own_pick, p.own_conf, p.exp_total, p.agree,
           public.calibrated_confidence(p.llm_conf, 'llm'),
           public.calibrated_confidence(p.own_conf, 'own'),
      from p
     order by p.commence_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

revoke all on function public.forecast_upcoming_v2(integer, text) from public;
grant execute on function public.forecast_upcoming_v2(integer, text) to anon, authenticated, service_role;
