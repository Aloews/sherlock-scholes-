-- Virtual-only bankroll for the LLM forecast model.
-- No real-money transactions, bookmaker execution, or client access.

create table if not exists public.llm_paper_bankroll (
  id boolean primary key default true check (id),
  initial_balance numeric(14,2) not null default 10000.00 check (initial_balance > 0),
  balance numeric(14,2) not null default 10000.00 check (balance >= 0),
  peak_balance numeric(14,2) not null default 10000.00 check (peak_balance >= balance),
  settled_predictions integer not null default 0 check (settled_predictions >= 0),
  placed_positions integer not null default 0 check (placed_positions >= 0),
  wins integer not null default 0 check (wins >= 0),
  updated_at timestamptz not null default now()
);

insert into public.llm_paper_bankroll (id) values (true)
on conflict (id) do nothing;

create table if not exists public.llm_paper_policy (
  id boolean primary key default true check (id),
  kelly_fraction numeric(5,4) not null default 0.1000 check (kelly_fraction between 0.05 and 0.25),
  confidence_floor numeric(5,4) not null default 0.4000 check (confidence_floor between 0.35 and 0.65),
  max_stake_fraction numeric(5,4) not null default 0.0200 check (max_stake_fraction between 0.005 and 0.02),
  last_window_roi numeric(8,5),
  last_policy_update timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.llm_paper_policy (id) values (true)
on conflict (id) do nothing;

create table if not exists public.llm_paper_ledger (
  fixture_id text primary key,
  commence_at timestamptz not null,
  pick text not null check (pick in ('H', 'D', 'A')),
  actual text not null check (actual in ('H', 'D', 'A')),
  raw_confidence numeric(6,5) not null check (raw_confidence between 0 and 1),
  calibrated_confidence numeric(6,5) not null check (calibrated_confidence between 0 and 1),
  decimal_odds numeric(8,3),
  stake numeric(14,2) not null default 0 check (stake >= 0),
  won boolean,
  profit numeric(14,2) not null default 0,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  peak_after numeric(14,2) not null check (peak_after >= balance_after),
  settled_at timestamptz not null default now()
);

create index if not exists llm_paper_ledger_settled_at_idx
  on public.llm_paper_ledger (settled_at desc);

alter table public.llm_paper_bankroll enable row level security;
alter table public.llm_paper_ledger enable row level security;
alter table public.llm_paper_policy enable row level security;
revoke all on public.llm_paper_bankroll from public, anon, authenticated;
revoke all on public.llm_paper_ledger from public, anon, authenticated;
revoke all on public.llm_paper_policy from public, anon, authenticated;
grant select, insert, update on public.llm_paper_bankroll to service_role;
grant select, insert on public.llm_paper_ledger to service_role;
grant select, insert, update on public.llm_paper_policy to service_role;

create or replace function public.settle_llm_paper_bankroll()
returns table (
  settled integer,
  placed integer,
  balance numeric,
  profit numeric,
  wins integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.llm_paper_bankroll%rowtype;
  policy public.llm_paper_policy%rowtype;
  p record;
  v_odds numeric;
  v_prob numeric;
  v_kelly numeric;
  v_stake numeric;
  v_won boolean;
  v_profit numeric;
  v_settled integer := 0;
  v_placed integer := 0;
begin
  select * into a from public.llm_paper_bankroll where id = true for update;
  if not found then
    raise exception 'paper bankroll account is not initialized';
  end if;
  select * into policy from public.llm_paper_policy where id = true for update;
  if not found then
    raise exception 'paper bankroll policy is not initialized';
  end if;

  for p in
    select fp.fixture_id, fp.commence_at, fp.pick, fp.confidence, fp.actual
      from public.forecast_pick fp
     where fp.model = 'llm'
       and fp.actual in ('H', 'D', 'A')
       and coalesce(fp.backfilled, false) = false
       and fp.confidence between 0 and 1
       and not exists (
         select 1 from public.llm_paper_ledger l where l.fixture_id = fp.fixture_id
       )
     order by fp.commence_at, fp.fixture_id
  loop
    select case p.pick
             when 'H' then o.home_price
             when 'D' then o.draw_price
             when 'A' then o.away_price
           end
      into v_odds
      from public.fixture_odds o
     where o.fixture_id = p.fixture_id
       and o.taken_at < p.commence_at
       and case p.pick
             when 'H' then o.home_price
             when 'D' then o.draw_price
             when 'A' then o.away_price
           end > 1
     order by o.taken_at desc
     limit 1;

    v_prob := greatest(0, least(1,
      public.calibrated_confidence(p.confidence, 'llm')));
    v_stake := 0;
    v_won := p.pick = p.actual;
    v_profit := 0;

    -- Adaptive Kelly fraction, capped at 2% of the current balance.
    -- A prediction without a pre-match price is recorded but cannot place a position.
    if v_odds is not null and v_prob >= policy.confidence_floor then
      v_kelly := (v_prob * v_odds - 1) / (v_odds - 1);
      if v_kelly > 0 and a.balance >= 1 then
        v_stake := round(a.balance * least(policy.max_stake_fraction, v_kelly * policy.kelly_fraction), 2);
        if v_stake < 1 then
          v_stake := 0;
        end if;
      end if;
    end if;

    if v_stake > 0 then
      v_placed := v_placed + 1;
      v_profit := case when v_won
                       then round(v_stake * (v_odds - 1), 2)
                       else -v_stake end;
      a.balance := greatest(0, a.balance + v_profit);
      a.peak_balance := greatest(a.peak_balance, a.balance);
      a.placed_positions := a.placed_positions + 1;
      if v_won then
        a.wins := a.wins + 1;
      end if;
    else
      v_won := null;
    end if;

    a.settled_predictions := a.settled_predictions + 1;
    insert into public.llm_paper_ledger (
      fixture_id, commence_at, pick, actual, raw_confidence,
      calibrated_confidence, decimal_odds, stake, won, profit,
      balance_after, peak_after
    ) values (
      p.fixture_id, p.commence_at, p.pick, p.actual, p.confidence,
      v_prob, v_odds, v_stake, v_won, v_profit, a.balance, a.peak_balance
    ) on conflict (fixture_id) do nothing;

    v_settled := v_settled + 1;
  end loop;

  update public.llm_paper_bankroll
     set balance = a.balance,
         peak_balance = a.peak_balance,
         settled_predictions = a.settled_predictions,
         placed_positions = a.placed_positions,
         wins = a.wins,
         updated_at = now()
   where id = true;

  return query
    select v_settled, v_placed, a.balance,
           round(a.balance - a.initial_balance, 2), a.wins;
end;
$$;

revoke all on function public.settle_llm_paper_bankroll() from public, anon, authenticated;
grant execute on function public.settle_llm_paper_bankroll() to service_role;

create or replace function public.llm_paper_bankroll_summary(p_password text default null)
returns table (
  initial_balance numeric,
  balance numeric,
  profit numeric,
  roi numeric,
  peak_balance numeric,
  max_drawdown numeric,
  settled_predictions integer,
  placed_positions integer,
  wins integer,
  win_rate numeric,
  kelly_fraction numeric,
  confidence_floor numeric,
  last_policy_update timestamptz,
  last_settled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and
     (p_password is null or not public.admin_check_password(p_password)) then
    perform public.require_pro();
  end if;
  return query
  select a.initial_balance,
         a.balance,
         round(a.balance - a.initial_balance, 2),
         round((a.balance - a.initial_balance) / nullif(a.initial_balance, 0) * 100, 2),
         a.peak_balance,
         coalesce((
           select round(max((l.peak_after - l.balance_after) / nullif(l.peak_after, 0) * 100), 2)
             from public.llm_paper_ledger l
         ), 0),
         a.settled_predictions,
         a.placed_positions,
         a.wins,
         round(a.wins::numeric / nullif(a.placed_positions, 0) * 100, 2),
         p.kelly_fraction,
         p.confidence_floor,
         p.last_policy_update,
         (select max(l.settled_at) from public.llm_paper_ledger l)
    from public.llm_paper_bankroll a
    join public.llm_paper_policy p on p.id = true
   where a.id = true;
end;
$$;

revoke all on function public.llm_paper_bankroll_summary(text) from public;
grant execute on function public.llm_paper_bankroll_summary(text) to anon, authenticated, service_role;

-- Remove persisted state for the retired predictor.
delete from public.forecast_pick where model = 'fly';
delete from public.forecast_calibration where model = 'fly';
alter table public.forecast_pick drop constraint if exists forecast_pick_model_check;
alter table public.forecast_pick
  add constraint forecast_pick_model_check check (model in ('llm', 'own'));
alter table public.forecast_calibration drop constraint if exists forecast_calibration_model_check;
alter table public.forecast_calibration
  add constraint forecast_calibration_model_check check (model in ('llm', 'own'));
drop table if exists public.fly_state;


create or replace function public.train_llm_paper_policy()
returns table (
  updated boolean,
  kelly_fraction numeric,
  confidence_floor numeric,
  window_roi numeric,
  sample_size integer
)
language plpgsql
security definer
set search_path = public
as $
declare
  p public.llm_paper_policy%rowtype;
  v_n integer;
  v_new integer;
  v_roi numeric;
  v_drawdown numeric;
  v_kelly numeric;
  v_floor numeric;
  v_latest_position timestamptz;
begin
  select * into p from public.llm_paper_policy where id = true for update;
  if not found then
    raise exception 'paper bankroll policy is not initialized';
  end if;

  select count(*)::integer into v_new
    from public.llm_paper_ledger
   where stake > 0
     and settled_at > coalesce(p.last_policy_update, '-infinity'::timestamptz);
  if coalesce(v_new, 0) < 5 then
    return query select false, p.kelly_fraction, p.confidence_floor, p.last_window_roi, coalesce(v_new, 0);
    return;
  end if;

  with recent as (
    select * from public.llm_paper_ledger
     where stake > 0
     order by settled_at desc, fixture_id desc
     limit 30
  )
  select count(*)::integer,
         sum(profit) / nullif(sum(stake), 0),
         coalesce(max((peak_after - balance_after) / nullif(peak_after, 0)), 0)
    into v_n, v_roi, v_drawdown
    from recent;

  select max(settled_at) into v_latest_position
    from public.llm_paper_ledger where stake > 0;

  if coalesce(v_n, 0) < 20
     or v_latest_position is null
     or (p.last_policy_update is not null and v_latest_position <= p.last_policy_update) then
    return query select false, p.kelly_fraction, p.confidence_floor, v_roi, coalesce(v_n, 0);
    return;
  end if;

  v_kelly := p.kelly_fraction;
  v_floor := p.confidence_floor;

  if coalesce(v_roi, 0) < 0 or coalesce(v_drawdown, 0) > 0.10 then
    v_kelly := greatest(0.05, round(v_kelly * 0.80, 4));
    v_floor := least(0.65, round(v_floor + 0.02, 4));
  elsif v_roi > 0.05 and coalesce(v_drawdown, 0) < 0.05 then
    v_kelly := least(0.25, round(v_kelly * 1.05, 4));
    v_floor := greatest(0.35, round(v_floor - 0.01, 4));
  end if;

  update public.llm_paper_policy
     set kelly_fraction = v_kelly,
         confidence_floor = v_floor,
         last_window_roi = v_roi,
         last_policy_update = now(),
         updated_at = now()
   where id = true;

  return query select (v_kelly <> p.kelly_fraction or v_floor <> p.confidence_floor),
                      v_kelly, v_floor, v_roi, v_n;
end;
$;

revoke all on function public.train_llm_paper_policy() from public, anon, authenticated;
grant execute on function public.train_llm_paper_policy() to service_role;

drop function if exists public.forecast_scoreboard();
drop function if exists public.forecast_scoreboard(text);
create function public.forecast_scoreboard(p_password text default null)
returns table (
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
set search_path = public
set statement_timeout to '4s'
as $$
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
         and fp.model in ('llm', 'own')
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
$$;

revoke all on function public.forecast_scoreboard(text) from public;
grant execute on function public.forecast_scoreboard(text) to anon, authenticated, service_role;

drop function if exists public.forecast_upcoming(integer, text);
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
  agree integer,
  llm_cal numeric,
  own_cal numeric
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout to '4s'
as $$
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
$$;

revoke all on function public.forecast_upcoming(integer, text) from public;
grant execute on function public.forecast_upcoming(integer, text) to anon, authenticated, service_role;

