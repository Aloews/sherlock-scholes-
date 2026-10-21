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

\ir ../migrations/20261021140431_requeue_photo_tm_no_data_failures.sql

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

rollback;
