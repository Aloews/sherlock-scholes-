-- Jobs seeded with max_attempts = 0 are permanently unclaimable:
-- claim_profile_backfill_jobs requires attempts < max_attempts.
-- Restore a bounded retry budget only for pending, never-attempted jobs in
-- the two affected task classes. Do not reset attempts or alter terminal rows.
update public.profile_backfill_jobs
   set max_attempts = 3,
       updated_at = now(),
       last_error = null
 where status = 'pending'
   and attempts = 0
   and max_attempts = 0
   and task_type in ('photo_tm', 'season_stats');

do $$
begin
  if exists (
    select 1
      from public.profile_backfill_jobs
     where status = 'pending'
       and attempts = 0
       and max_attempts = 0
       and task_type in ('photo_tm', 'season_stats')
  ) then
    raise exception 'Backfill queue repair incomplete: zero-attempt pending jobs remain';
  end if;
end
$$;
