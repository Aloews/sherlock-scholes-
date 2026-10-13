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
revoke all on public.llm_paper_bankroll from public, anon, authenticated;
revoke all on public.llm_paper_ledger from public, anon, authenticated;
grant select, insert, update on public.llm_paper_bankroll to service_role;
grant select, insert on public.llm_paper_ledger to service_role;

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

    -- Conservative quarter-Kelly, capped at 2% of the current balance.
    -- A prediction without a pre-match price is recorded but cannot place a position.
    if v_odds is not null and v_prob > 0 then
      v_kelly := (v_prob * v_odds - 1) / (v_odds - 1);
      if v_kelly > 0 and a.balance >= 1 then
        v_stake := round(a.balance * least(0.02, v_kelly * 0.25), 2);
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
         (select max(l.settled_at) from public.llm_paper_ledger l)
    from public.llm_paper_bankroll a
   where a.id = true;
end;
$$;

revoke all on function public.llm_paper_bankroll_summary(text) from public;
grant execute on function public.llm_paper_bankroll_summary(text) to anon, authenticated, service_role;

-- Remove persisted state for the retired predictor.
delete from public.forecast_pick where model = 'fly';
delete from public.forecast_calibration where model = 'fly';
delete from public.forecast_duel_model where model = 'fly';
drop table if exists public.fly_state;

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
  dopamine integer,
  backfilled integer
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout to '4s'
as $$
begin
  if p_password is null or not public.admin_check_password(p_password) then
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
           coalesce(r.streak, 0), 0::integer, b.backfilled
      from base b left join run r on r.model = b.model
     order by b.accuracy desc nulls last;
end;
$$;

revoke all on function public.forecast_scoreboard(text) from public;
grant execute on function public.forecast_scoreboard(text) to anon, authenticated, service_role;
