-- Jobs created by the old Transfermarkt collector classified a confirmed
-- zero-photo result as a transport failure and exhausted all attempts. The new
-- collector distinguishes permanent no-profile responses from transport loss.
-- Requeue only those terminal jobs whose audit explicitly shows both the old
-- generic error and a zero-photo Wikidata fallback.
update public.profile_backfill_jobs
   set status = 'pending',
       attempts = 0,
       last_error = null,
       verified_at = null,
       updated_at = now() - interval '61 minutes'
 where task_type = 'photo_tm'
   and status = 'failed'
   and attempts >= max_attempts
   and last_error ilike '%No player portraits were written; investigate source access or candidate selection.%'
   and last_error ilike '%Wikidata fallback attempt:%'
   and last_error ilike '%фото найдено%0%';
