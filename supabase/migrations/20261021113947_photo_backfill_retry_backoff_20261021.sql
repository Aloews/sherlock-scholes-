-- Do not burn a run retrying the same transient failure repeatedly.
-- Fresh jobs run immediately; pending retries wait one hour. Stale running jobs
-- are reclaimable even when their attempt counter has reached the limit.
create or replace function public.claim_profile_backfill_jobs(
  p_limit integer default 20,
  p_lease_minutes integer default 45
)
returns setof public.profile_backfill_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_lease_minutes is null or p_lease_minutes < 5 or p_lease_minutes > 240 then
    raise exception 'invalid claim limits' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select j.id
      from public.profile_backfill_jobs j
     where (
       (j.status='pending' and j.attempts < j.max_attempts
        and (j.attempts=0 or j.updated_at < now()-interval '60 minutes'))
       or
       (j.status='running' and j.updated_at < now()-make_interval(mins=>p_lease_minutes))
     )
     order by j.priority desc,j.created_at,j.id
     for update skip locked
     limit p_limit
  )
  update public.profile_backfill_jobs j
     set status='running',attempts=least(j.attempts+1,j.max_attempts),updated_at=now(),last_error=null
    from candidates c
   where j.id=c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_profile_backfill_jobs(integer,integer) from public, anon, authenticated;
grant execute on function public.claim_profile_backfill_jobs(integer,integer) to service_role;
