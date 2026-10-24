begin;

-- Requeue unresolved photo tasks after adding the Dutch regional profile source.
-- Existing photo URLs and their jobs are not changed.
update public.profile_backfill_jobs j
   set status = 'pending',
       transfermarkt_id = coalesce(nullif(btrim(j.transfermarkt_id), ''), nullif(btrim(c.transfermarkt_id), '')),
       wikidata_qid = coalesce(nullif(btrim(j.wikidata_qid), ''), nullif(btrim(c.wikidata_qid), '')),
       attempts = 0,
       updated_at = now(),
       last_error = null,
       verified_at = null
  from public.cards c
 where c.id = j.card_id
   and j.task_type in ('photo_qid', 'photo_tm')
   and j.status = 'no_data'
   and nullif(btrim(c.photo_url), '') is null
   and coalesce(nullif(btrim(j.transfermarkt_id), ''), nullif(btrim(c.transfermarkt_id), '')) is not null;

commit;
