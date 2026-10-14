-- Profile backfill queue, multi-market quote ledger, settlement rules, and
-- append-only examples for reproducible language-model fine-tuning.
-- Reviewed in GitHub first; do not apply to production before release approval.

create table if not exists public.profile_backfill_jobs (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  task_type text not null check (task_type in ('photo_tm','photo_qid','season_stats')),
  transfermarkt_id text, wikidata_qid text, priority numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','running','succeeded','no_data','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), verified_at timestamptz,
  unique (card_id, task_type)
);
create index if not exists profile_backfill_claim_idx on public.profile_backfill_jobs(status, priority desc, created_at, id);
create index if not exists profile_backfill_card_idx on public.profile_backfill_jobs(card_id, task_type);
alter table public.profile_backfill_jobs enable row level security;
revoke all on public.profile_backfill_jobs from public, anon, authenticated;
grant all on public.profile_backfill_jobs to service_role;

create or replace function public.enqueue_profile_backfill_jobs(p_limit integer default 50000)
returns integer language plpgsql security definer set search_path = public as $$
declare v_inserted integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'p_limit must be between 1 and 100000' using errcode = '22023';
  end if;
  with candidates as (
    select c.id card_id, 'photo_tm'::text task_type, c.transfermarkt_id::text transfermarkt_id,
           c.wikidata_qid::text wikidata_qid, coalesce(c.market_value_eur,0)::numeric + 1000000000 priority
      from cards c where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null and nullif(btrim(c.transfermarkt_id::text),'') is not null
    union all
    select c.id, 'photo_qid', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur,0)::numeric + 500000000
      from cards c where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null and nullif(btrim(c.wikidata_qid::text),'') is not null
    union all
    select c.id, 'season_stats', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur,0)::numeric
      from cards c where c.category='player' and c.active is true
       and nullif(btrim(c.transfermarkt_id::text),'') is not null
       and not exists (select 1 from player_season_stat s where s.tm_player_id=c.transfermarkt_id::text)
  ), limited as (
    select * from candidates order by priority desc, card_id, task_type limit p_limit
  ), inserted as (
    insert into profile_backfill_jobs(card_id,task_type,transfermarkt_id,wikidata_qid,priority)
    select card_id,task_type,transfermarkt_id,wikidata_qid,priority from limited
    on conflict(card_id,task_type) do nothing returning 1
  )
  select count(*) into v_inserted from inserted;
  return v_inserted;
end;
$$;

create or replace function public.claim_profile_backfill_jobs(p_limit integer default 20, p_lease_minutes integer default 45)
returns setof public.profile_backfill_jobs
language plpgsql security definer set search_path = public as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_lease_minutes is null or p_lease_minutes < 5 or p_lease_minutes > 240 then
    raise exception 'invalid claim limits' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select j.id from profile_backfill_jobs j
     where j.attempts < j.max_attempts
       and (j.status='pending' or (j.status='running' and j.updated_at < now()-make_interval(mins=>p_lease_minutes)))
     order by j.priority desc,j.created_at,j.id for update skip locked limit p_limit
  )
  update profile_backfill_jobs j set status='running',attempts=j.attempts+1,updated_at=now(),last_error=null
    from candidates c where j.id=c.id returning j.*;
end;
$$;

create or replace function public.finish_profile_backfill_job(
  p_job_id bigint,p_verified boolean,p_no_data boolean default false,p_error text default null
) returns text language plpgsql security definer set search_path=public as $$
declare v_job profile_backfill_jobs%rowtype;
begin
  select * into v_job from profile_backfill_jobs where id=p_job_id for update;
  if not found then raise exception 'profile backfill job not found' using errcode='P0002'; end if;
  if v_job.status <> 'running' then raise exception 'profile backfill job is not running' using errcode='22023'; end if;
  if p_verified then
    update profile_backfill_jobs set status='succeeded',verified_at=now(),updated_at=now(),last_error=null where id=p_job_id;
    return 'succeeded';
  elsif p_no_data then
    update profile_backfill_jobs set status='no_data',verified_at=now(),updated_at=now(),last_error=null where id=p_job_id;
    return 'no_data';
  elsif v_job.attempts >= v_job.max_attempts then
    update profile_backfill_jobs set status='failed',updated_at=now(),last_error=left(coalesce(p_error,'verification failed'),2000) where id=p_job_id;
    return 'failed';
  else
    update profile_backfill_jobs set status='pending',updated_at=now(),last_error=left(coalesce(p_error,'verification failed'),2000) where id=p_job_id;
    return 'pending';
  end if;
end;
$$;
revoke all on function public.enqueue_profile_backfill_jobs(integer) from public,anon,authenticated;
revoke all on function public.claim_profile_backfill_jobs(integer,integer) from public,anon,authenticated;
revoke all on function public.finish_profile_backfill_job(bigint,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.enqueue_profile_backfill_jobs(integer) to service_role;
grant execute on function public.claim_profile_backfill_jobs(integer,integer) to service_role;
grant execute on function public.finish_profile_backfill_job(bigint,boolean,boolean,text) to service_role;

create table if not exists public.fixture_market_quotes (
  fixture_id text not null references public.fixtures(id) on delete cascade,
  taken_at timestamptz not null, provider text not null default 'the-odds-api',
  bookmaker text not null, region text not null default 'eu',
  market_key text not null check (market_key in ('h2h','spreads','totals','btts')),
  outcome_key text not null, outcome_name text not null,
  point numeric(8,3) not null default 0, price numeric(8,3) not null check (price > 1),
  settlement_status text check (settlement_status in ('won','lost','push','half_won','half_lost','void')),
  settled_at timestamptz,
  primary key(fixture_id,taken_at,provider,bookmaker,region,market_key,outcome_key,point)
);
create index if not exists fixture_market_quotes_lookup_idx on public.fixture_market_quotes(fixture_id,market_key,taken_at desc);
create index if not exists fixture_market_quotes_settle_idx on public.fixture_market_quotes(settlement_status,fixture_id);
create table if not exists public.odds_market_settlement_rules (
  market_key text primary key, settlement_method text not null, version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.odds_market_settlement_rules(market_key,settlement_method)
values ('h2h','three_way_result'),('spreads','handicap'),('totals','total_goals'),('btts','both_teams_score')
on conflict(market_key) do update set settlement_method=excluded.settlement_method,version=excluded.version,updated_at=now();

create table if not exists public.odds_api_usage (
  request_key text primary key, month date not null, provider text not null,
  sport_key text not null, region text not null, markets text[] not null,
  credits integer not null check (credits > 0),
  status text not null default 'reserved' check (status in ('reserved','success','failed')),
  response_count integer, provider_remaining integer, error_code text,
  reserved_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists odds_api_usage_month_idx on public.odds_api_usage(month,status);
alter table public.fixture_market_quotes enable row level security;
alter table public.odds_market_settlement_rules enable row level security;
alter table public.odds_api_usage enable row level security;
revoke all on public.fixture_market_quotes,public.odds_market_settlement_rules,public.odds_api_usage from public,anon,authenticated;
grant all on public.fixture_market_quotes,public.odds_market_settlement_rules,public.odds_api_usage to service_role;

create or replace function public.spend_odds_credits_with_reserve(
  p_credits integer, p_min_remaining integer default 80
)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_after integer;
begin
  if p_credits is null or p_credits < 1 or p_min_remaining is null or p_min_remaining < 0 then
    raise exception 'invalid credits or reserve' using errcode='22023';
  end if;
  insert into odds_api_budget(month,credits) values(v_month,0)
  on conflict(month) do update set month=excluded.month
  returning credits into v_after;
  if v_after + p_credits > greatest(0,odds_api_monthly_limit()-p_min_remaining) then
    return false;
  end if;
  update odds_api_budget set credits=credits+p_credits,updated_at=now() where month=v_month;
  return true;
end;
$fn$;

create or replace function public.reserve_odds_api_request(
  p_request_key text,p_provider text,p_sport_key text,p_region text,p_markets text[],p_credits integer
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_month date:=date_trunc('month',now() at time zone 'utc')::date; v_rows integer;
begin
  if nullif(btrim(p_request_key),'') is null or p_credits is null or p_credits<1 or coalesce(array_length(p_markets,1),0)<1 then
    raise exception 'invalid odds request reservation' using errcode='22023';
  end if;
  insert into odds_api_usage(request_key,month,provider,sport_key,region,markets,credits)
  values(p_request_key,v_month,coalesce(nullif(p_provider,''),'the-odds-api'),p_sport_key,p_region,p_markets,p_credits)
  on conflict(request_key) do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return false; end if;
  if not public.spend_odds_credits_with_reserve(p_credits,80) then
    delete from odds_api_usage where request_key=p_request_key;
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.finish_odds_api_request(
  p_request_key text,p_status text,p_response_count integer default null,
  p_provider_remaining integer default null,p_error_code text default null
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('success','failed') then raise exception 'status must be success or failed' using errcode='22023'; end if;
  update odds_api_usage set status=p_status,response_count=p_response_count,
    provider_remaining=p_provider_remaining,error_code=left(p_error_code,200),finished_at=now()
   where request_key=p_request_key and status='reserved';
  return found;
end;
$$;

create or replace function public.upsert_fixture_market_quotes(p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  insert into fixture_market_quotes(fixture_id,taken_at,provider,bookmaker,region,market_key,outcome_key,outcome_name,point,price)
  select r->>'fixture_id',coalesce(nullif(r->>'taken_at','')::timestamptz,now()),
    coalesce(nullif(r->>'provider',''),'the-odds-api'),r->>'bookmaker',coalesce(nullif(r->>'region',''),'eu'),
    r->>'market_key',r->>'outcome_key',r->>'outcome_name',coalesce(nullif(r->>'point','')::numeric,0),(r->>'price')::numeric
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
  where exists(select 1 from fixtures f where f.id=r->>'fixture_id')
    and exists(select 1 from odds_market_settlement_rules s where s.market_key=r->>'market_key')
    and nullif(r->>'bookmaker','') is not null and nullif(r->>'outcome_key','') is not null
    and nullif(r->>'outcome_name','') is not null and coalesce(nullif(r->>'price','')::numeric,0)>1
  on conflict(fixture_id,taken_at,provider,bookmaker,region,market_key,outcome_key,point)
  do update set outcome_name=excluded.outcome_name,price=excluded.price,settlement_status=null,settled_at=null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.settle_market_outcome(
  p_market text,p_outcome text,p_point numeric,p_home_score integer,p_away_score integer
) returns text language plpgsql immutable set search_path=public as $$
declare v_actual text; v_total numeric:=p_home_score+p_away_score; v_margin numeric;
        v_a numeric; v_b numeric; v_first text; v_second text;
begin
  if p_home_score is null or p_away_score is null then return null; end if;
  if p_market='h2h' then
    v_actual:=case when p_home_score>p_away_score then 'home' when p_home_score<p_away_score then 'away' else 'draw' end;
    return case when p_outcome=v_actual then 'won' else 'lost' end;
  elsif p_market='btts' then
    v_actual:=case when p_home_score>0 and p_away_score>0 then 'yes' else 'no' end;
    return case when lower(p_outcome)=v_actual then 'won' else 'lost' end;
  elsif p_market='totals' then
    if lower(p_outcome) not in ('over','under') then return null; end if;
    if abs(p_point*4-round(p_point*4))<0.0001 and abs(mod(round(p_point*4)::integer,2))=1 then
      v_a:=p_point-0.25; v_b:=p_point+0.25;
      if lower(p_outcome)='over' then
        v_first:=case when v_total>v_a then 'won' when v_total<v_a then 'lost' else 'push' end;
        v_second:=case when v_total>v_b then 'won' when v_total<v_b then 'lost' else 'push' end;
      else
        v_first:=case when v_total<v_a then 'won' when v_total>v_a then 'lost' else 'push' end;
        v_second:=case when v_total<v_b then 'won' when v_total>v_b then 'lost' else 'push' end;
      end if;
    else
      v_margin:=case when lower(p_outcome)='over' then v_total-p_point else p_point-v_total end;
      return case when v_margin>0 then 'won' when v_margin<0 then 'lost' else 'push' end;
    end if;
  elsif p_market='spreads' then
    if lower(p_outcome)='home' then v_margin:=p_home_score+p_point-p_away_score;
    elsif lower(p_outcome)='away' then v_margin:=p_away_score+p_point-p_home_score;
    else return null; end if;
    if abs(p_point*4-round(p_point*4))<0.0001 and abs(mod(round(p_point*4)::integer,2))=1 then
      v_a:=p_point-0.25; v_b:=p_point+0.25;
      if lower(p_outcome)='home' then
        v_first:=case when p_home_score+v_a>p_away_score then 'won' when p_home_score+v_a<p_away_score then 'lost' else 'push' end;
        v_second:=case when p_home_score+v_b>p_away_score then 'won' when p_home_score+v_b<p_away_score then 'lost' else 'push' end;
      else
        v_first:=case when p_away_score+v_a>p_home_score then 'won' when p_away_score+v_a<p_home_score then 'lost' else 'push' end;
        v_second:=case when p_away_score+v_b>p_home_score then 'won' when p_away_score+v_b<p_home_score then 'lost' else 'push' end;
      end if;
    else
      return case when v_margin>0 then 'won' when v_margin<0 then 'lost' else 'push' end;
    end if;
  else return null;
  end if;
  if v_first='won' and v_second='won' then return 'won'; end if;
  if v_first='lost' and v_second='lost' then return 'lost'; end if;
  if (v_first='won' and v_second='push') or (v_second='won' and v_first='push') then return 'half_won'; end if;
  if (v_first='lost' and v_second='push') or (v_second='lost' and v_first='push') then return 'half_lost'; end if;
  if v_first='push' and v_second='push' then return 'push'; end if;
  return 'void';
end;
$$;

create or replace function public.settle_fixture_market_quotes(p_fixture_id text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update fixture_market_quotes q
    set settlement_status=public.settle_market_outcome(q.market_key,q.outcome_key,q.point,f.home_score,f.away_score),
        settled_at=coalesce(f.scores_at,now())
   from fixtures f
  where f.id=q.fixture_id and (p_fixture_id is null or f.id=p_fixture_id)
    and f.completed is true and f.home_score is not null and f.away_score is not null
    and f.commence_at<now() and q.taken_at<f.commence_at and q.settlement_status is null
    and exists(select 1 from odds_market_settlement_rules r where r.market_key=q.market_key);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.settle_market_quotes_after_fixture_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.completed is true and new.home_score is not null and new.away_score is not null
     and new.commence_at < now() then
    perform public.settle_fixture_market_quotes(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists fixtures_settle_market_quotes on public.fixtures;
create trigger fixtures_settle_market_quotes
after update of completed,home_score,away_score,scores_at on public.fixtures
for each row execute function public.settle_market_quotes_after_fixture_update();
revoke all on function public.settle_market_quotes_after_fixture_update() from public,anon,authenticated;

revoke all on function public.spend_odds_credits_with_reserve(integer,integer) from public,anon,authenticated;
grant execute on function public.spend_odds_credits_with_reserve(integer,integer) to service_role;
revoke all on function public.reserve_odds_api_request(text,text,text,text,text[],integer) from public,anon,authenticated;
revoke all on function public.finish_odds_api_request(text,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.upsert_fixture_market_quotes(jsonb) from public,anon,authenticated;
revoke all on function public.settle_market_outcome(text,text,numeric,integer,integer) from public,anon,authenticated;
revoke all on function public.settle_fixture_market_quotes(text) from public,anon,authenticated;
grant execute on function public.reserve_odds_api_request(text,text,text,text,text[],integer) to service_role;
grant execute on function public.finish_odds_api_request(text,text,integer,integer,text) to service_role;
grant execute on function public.upsert_fixture_market_quotes(jsonb) to service_role;
grant execute on function public.settle_fixture_market_quotes(text) to service_role;

create table if not exists public.llm_finetune_examples (
  fixture_id text primary key references public.fixtures(id) on delete cascade,
  commence_at timestamptz not null, feature_cutoff_at timestamptz not null,
  odds_snapshot_at timestamptz, input_context jsonb not null,
  target_outcome text check (target_outcome in ('home','draw','away')),
  settled_at timestamptz, created_at timestamptz not null default now()
);
alter table public.llm_finetune_examples enable row level security;
revoke all on public.llm_finetune_examples from public,anon,authenticated;
grant all on public.llm_finetune_examples to service_role;

create or replace function public.capture_llm_finetune_example()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_context jsonb; v_odds_at timestamptz;
begin
  if new.model<>'llm' or new.commence_at<=new.made_at then return new; end if;
  select jsonb_build_object('fixture_id',i.fixture_id,'sport_key',f.sport_key,
    'home_team',f.home_team,'away_team',f.away_team,'features',to_jsonb(i),
    'odds',jsonb_build_object('home',o.home_price,'draw',o.draw_price,'away',o.away_price)),o.taken_at
    into v_context,v_odds_at
    from forecast_inputs i join fixtures f on f.id=i.fixture_id
    left join lateral (select fo.taken_at,fo.home_price,fo.draw_price,fo.away_price
      from fixture_odds fo where fo.fixture_id=f.id and fo.taken_at<=new.made_at and fo.taken_at<f.commence_at
      order by fo.taken_at desc limit 1) o on true
   where i.fixture_id=new.fixture_id and f.commence_at=new.commence_at and f.commence_at>new.made_at
   limit 1;
  if v_context is not null then
    insert into llm_finetune_examples(fixture_id,commence_at,feature_cutoff_at,odds_snapshot_at,input_context)
    values(new.fixture_id,new.commence_at,new.made_at,v_odds_at,v_context) on conflict(fixture_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists forecast_pick_capture_llm_finetune on public.forecast_pick;
create trigger forecast_pick_capture_llm_finetune after insert on public.forecast_pick
for each row execute function public.capture_llm_finetune_example();

create or replace function public.export_llm_finetune_examples()
returns table(fixture_id text,commence_at timestamptz,feature_cutoff_at timestamptz,
  odds_snapshot_at timestamptz,settled_at timestamptz,input_context jsonb,target_outcome text)
language plpgsql security definer set search_path=public as $$
begin
  update llm_finetune_examples e
     set target_outcome=case when f.home_score>f.away_score then 'home'
                             when f.home_score<f.away_score then 'away' else 'draw' end,
         settled_at=coalesce(f.scores_at,f.updated_at)
    from fixtures f where f.id=e.fixture_id and f.completed is true
     and f.home_score is not null and f.away_score is not null
     and coalesce(f.scores_at,f.updated_at)>=f.commence_at and e.target_outcome is null;
  return query select e.fixture_id,e.commence_at,e.feature_cutoff_at,e.odds_snapshot_at,e.settled_at,e.input_context,e.target_outcome
    from llm_finetune_examples e where e.target_outcome is not null
     and e.feature_cutoff_at<e.commence_at and e.odds_snapshot_at is not null
     and e.odds_snapshot_at<e.commence_at and e.settled_at>=e.commence_at
    order by e.commence_at,e.fixture_id;
end;
$$;
revoke all on function public.capture_llm_finetune_example() from public,anon,authenticated;
revoke all on function public.export_llm_finetune_examples() from public,anon,authenticated;
grant execute on function public.export_llm_finetune_examples() to service_role;

comment on table public.profile_backfill_jobs is 'Auditable per-player/source enrichment tasks; success requires read-after-write verification.';
comment on table public.fixture_market_quotes is 'Internal bookmaker quote ledger for h2h, spreads, totals and btts; no client access.';
comment on table public.odds_api_usage is 'Idempotent request-level API quota ledger; credits reserved before provider requests.';
comment on table public.llm_finetune_examples is 'Pre-kickoff feature and odds snapshots linked to settled match labels for reproducible fine-tuning.';
