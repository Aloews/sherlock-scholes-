create or replace function public.finish_profile_backfill_job(
  p_job_id bigint,
  p_verified boolean,
  p_no_data boolean default false,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job profile_backfill_jobs%rowtype;
begin
  select * into v_job
    from profile_backfill_jobs
   where id=p_job_id
   for update;
  if not found then
    raise exception 'profile backfill job not found' using errcode='P0002';
  end if;
  if v_job.status <> 'running' then
    raise exception 'profile backfill job is not running' using errcode='22023';
  end if;
  if p_verified then
    update profile_backfill_jobs
       set status='succeeded',verified_at=now(),updated_at=now(),last_error=null
     where id=p_job_id;
    return 'succeeded';
  elsif p_no_data then
    update profile_backfill_jobs
       set status='no_data',verified_at=now(),updated_at=now(),
           last_error=left(coalesce(p_error,'source returned no matching data'),2000)
     where id=p_job_id;
    return 'no_data';
  elsif v_job.attempts >= v_job.max_attempts then
    update profile_backfill_jobs
       set status='failed',updated_at=now(),last_error=left(coalesce(p_error,'verification failed'),2000)
     where id=p_job_id;
    return 'failed';
  else
    update profile_backfill_jobs
       set status='pending',updated_at=now(),last_error=left(coalesce(p_error,'verification failed'),2000)
     where id=p_job_id;
    return 'pending';
  end if;
end;
$$;

revoke all on function public.finish_profile_backfill_job(bigint,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.finish_profile_backfill_job(bigint,boolean,boolean,text) to service_role;
