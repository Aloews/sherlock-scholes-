begin;

do $$
declare
  v_card uuid;
  v_job_id bigint;
  v_status text;
  v_attempts integer;
  v_updated timestamptz;
begin
  insert into public.cards(name,category,active,transfermarkt_id,wikidata_qid,market_value_eur)
  values('Legacy photo no-data retry regression','player',true,'tm-old-no-data-regression','Qoldnodata',1000)
  returning id into v_card;

  insert into public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,last_error,verified_at
  )
  values(
    v_card,'photo_tm','tm-old-no-data-regression','Qoldnodata',1000000,'failed',3,3,
    E'collector failed: No player portraits were written; investigate source access or candidate selection.\nWikidata fallback attempt:\nФото найдено : 0',
    now()
  )
  returning id into v_job_id;
end $$;

\ir ../migrations/20261021171000_requeue_photo_tm_no_data_failures.sql

do $$
declare
  v_job public.profile_backfill_jobs%rowtype;
begin
  select * into v_job from public.profile_backfill_jobs
   where transfermarkt_id='tm-old-no-data-regression' and task_type='photo_tm';
  if v_job.status <> 'pending' or v_job.attempts <> 0 or v_job.last_error is not null
     or v_job.verified_at is not null or v_job.updated_at >= now()-interval '60 minutes' then
    raise exception 'legacy terminal no-data job was not safely requeued: %', row_to_json(v_job);
  end if;
end $$;

rollback;
