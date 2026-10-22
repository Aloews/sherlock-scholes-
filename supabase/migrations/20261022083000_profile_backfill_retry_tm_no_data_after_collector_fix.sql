-- Retry terminal Transfermarkt no-data jobs once after the collector fix.
-- Only cards still missing a photo are eligible. Preserve the prior diagnostic
-- so the next attempt can be compared with the old result. Never touch photo_url
-- or photo_source.
with retryable as (
  select j.id,
         left(coalesce(j.last_error, ''), 2000) as previous_reason
    from public.profile_backfill_jobs j
    join public.cards c on c.id = j.card_id
   where j.task_type = 'photo_tm'
     and j.status = 'no_data'
     and c.category = 'player'
     and nullif(btrim(c.photo_url), '') is null
)
update public.profile_backfill_jobs j
   set status = 'pending',
       attempts = 0,
       last_error = 'requeued_after_transfermarkt_collector_fix_2026-10-22; previous_reason='
                    || coalesce(nullif(r.previous_reason, ''), '<empty>'),
       verified_at = null,
       updated_at = now() - interval '61 minutes'
  from retryable r
 where j.id = r.id;
