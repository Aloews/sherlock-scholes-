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

do $$
declare
  v_card uuid;
  v_job_id bigint;
begin
  insert into public.cards(name,category,active,transfermarkt_id,wikidata_qid,market_value_eur)
  values('Fresh Soccer Wiki portrait regression','player',true,'tm-sw-fresh-photo-regression','Qswfreshphoto',2000)
  returning id into v_card;

  insert into public.soccerwiki_player(name,card_id,photo_url)
  values('Fresh Soccer Wiki portrait regression',v_card,'https://cdn.soccerwiki.org/images/player/999999.png');

  insert into public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,last_error,updated_at
  )
  values(
    v_card,'photo_sw','tm-sw-fresh-photo-regression','Qswfreshphoto',1000000000,'no_data',1,3,
    'No identity-verified Soccer Wiki photo matches card',now()-interval '2 minutes'
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

do $$
declare
  v_card uuid;
  v_job public.profile_backfill_jobs%rowtype;
begin
  select id into v_card from public.cards where name='Fresh Soccer Wiki portrait regression' limit 1;
  update public.soccerwiki_player
     set detail_at=now()
   where card_id=v_card and photo_url='https://cdn.soccerwiki.org/images/player/999999.png';

  perform public.enqueue_profile_backfill_jobs(100);
  select * into v_job from public.profile_backfill_jobs
   where card_id=v_card and task_type='photo_sw';
  if v_job.status <> 'pending' or v_job.attempts <> 0 then
    raise exception 'new Soccer Wiki detail/photo was not requeued immediately: %', row_to_json(v_job);
  end if;
end $$;


-- Requeue only Transfermarkt no-data jobs whose cards still have no photo.
do $
declare
  v_missing_card uuid;
  v_photo_card uuid;
  v_missing_job bigint;
  v_photo_job bigint;
  v_qid_job bigint;
begin
  insert into public.cards(name,category,active,transfermarkt_id,wikidata_qid,photo_url,photo_source)
  values('Transfermarkt collector retry missing-photo regression','player',true,'tm-retry-missing-photo','Qtmretrymissing',null,null)
  returning id into v_missing_card;

  insert into public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,last_error,verified_at
  ) values (
    v_missing_card,'photo_tm','tm-retry-missing-photo','Qtmretrymissing',1000,'no_data',2,3,
    E'Карточек без фото: 1\\nПортретов найдено : 0',now()
  ) returning id into v_missing_job;

  insert into public.cards(name,category,active,transfermarkt_id,wikidata_qid,photo_url,photo_source)
  values('Transfermarkt collector retry existing-photo regression','player',true,'tm-retry-existing-photo','Qtmretryexisting',
         'https://img.a.transfermarkt.technology/portrait/big/12345-123456.jpg','transfermarkt')
  returning id into v_photo_card;

  insert into public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,last_error,verified_at
  ) values (
    v_photo_card,'photo_tm','tm-retry-existing-photo','Qtmretryexisting',1000,'no_data',2,3,
    'old diagnostic must remain unchanged',now()
  ) returning id into v_photo_job;

  insert into public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,last_error
  ) values (
    v_missing_card,'photo_qid','tm-retry-missing-photo','Qtmretrymissing',1000,'no_data',2,3,
    'QID task is outside this migration'
  ) returning id into v_qid_job;
end $;

\\ir ../migrations/20261022083000_profile_backfill_retry_tm_no_data_after_collector_fix.sql

do $
declare
  v_missing public.profile_backfill_jobs%rowtype;
  v_existing public.profile_backfill_jobs%rowtype;
  v_qid public.profile_backfill_jobs%rowtype;
  v_photo_url text;
  v_photo_source text;
begin
  select * into v_missing from public.profile_backfill_jobs
   where transfermarkt_id='tm-retry-missing-photo' and task_type='photo_tm';
  if v_missing.status <> 'pending' or v_missing.attempts <> 0
     or v_missing.verified_at is not null
     or v_missing.last_error not like 'requeued_after_transfermarkt_collector_fix_2026-10-22; previous_reason=%'
     or v_missing.updated_at >= now()-interval '60 minutes' then
    raise exception 'missing-photo Transfermarkt job was not safely requeued: %', row_to_json(v_missing);
  end if;

  select * into v_existing from public.profile_backfill_jobs
   where transfermarkt_id='tm-retry-existing-photo' and task_type='photo_tm';
  select photo_url,photo_source into v_photo_url,v_photo_source
    from public.cards where transfermarkt_id='tm-retry-existing-photo';
  if v_existing.status <> 'no_data' or v_existing.attempts <> 2
     or v_existing.last_error <> 'old diagnostic must remain unchanged'
     or v_photo_url <> 'https://img.a.transfermarkt.technology/portrait/big/12345-123456.jpg'
     or v_photo_source <> 'transfermarkt' then
    raise exception 'existing photo or its job was changed: %', row_to_json(v_existing);
  end if;

  select * into v_qid from public.profile_backfill_jobs
   where transfermarkt_id='tm-retry-missing-photo' and task_type='photo_qid';
  if v_qid.status <> 'no_data' or v_qid.attempts <> 2
     or v_qid.last_error <> 'QID task is outside this migration' then
    raise exception 'non-Transfermarkt job was changed: %', row_to_json(v_qid);
  end if;
end $;

rollback;
