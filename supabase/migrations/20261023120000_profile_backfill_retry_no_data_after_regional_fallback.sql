begin;

-- Retry only unresolved photo tasks with a real Transfermarkt ID and no stored photo.
-- Existing photo URLs and unrelated task types are untouched.
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
   and coalesce(nullif(btrim(j.transfermarkt_id), ''), nullif(btrim(c.transfermarkt_id), '')) is not null
   and nullif(btrim(c.photo_url), '') is null;

commit;
