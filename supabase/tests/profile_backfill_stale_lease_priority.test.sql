BEGIN;

DO $$
DECLARE
  v_stale_card uuid;
  v_stale_job bigint;
  v_claimed public.profile_backfill_jobs%rowtype;
  v_pending_count integer;
BEGIN
  UPDATE public.profile_backfill_jobs
     SET status='succeeded', updated_at=now()
   WHERE status IN ('pending','running');

  UPDATE public.profile_backfill_claim_cursor
     SET last_task_type=NULL, updated_at=now()
   WHERE singleton=true;

  WITH inserted AS (
    INSERT INTO public.cards(name,category,active,transfermarkt_id,wikidata_qid,market_value_eur)
    SELECT 'Stale lease priority pending ' || g,
           'player',true,'tm-stale-lease-' || g,'Qstale-lease-' || g,100000
      FROM generate_series(1,120) g
    RETURNING id,transfermarkt_id,wikidata_qid
  )
  INSERT INTO public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,created_at,updated_at
  )
  SELECT id,'photo_tm',transfermarkt_id,wikidata_qid,999999,'pending',0,3,
         now()-interval '2 days',now()-interval '2 days'
    FROM inserted;

  INSERT INTO public.cards(name,category,active,transfermarkt_id,wikidata_qid,market_value_eur)
  VALUES('Stale lease priority expired running','player',true,'tm-stale-lease-running','Qstale-lease-running',100000)
  RETURNING id INTO v_stale_card;

  INSERT INTO public.profile_backfill_jobs(
    card_id,task_type,transfermarkt_id,wikidata_qid,priority,status,attempts,max_attempts,created_at,updated_at
  )
  VALUES(
    v_stale_card,'photo_tm','tm-stale-lease-running','Qstale-lease-running',
    1,'running',1,3,now()-interval '1 day',now()-interval '46 minutes'
  )
  RETURNING id INTO v_stale_job;

  SELECT * INTO v_claimed
    FROM public.claim_profile_backfill_jobs(1,45);

  IF v_claimed.id IS DISTINCT FROM v_stale_job
     OR v_claimed.status <> 'running'
     OR v_claimed.attempts <> 2 THEN
    RAISE EXCEPTION 'expired running lease was starved by pending backlog: %',row_to_json(v_claimed);
  END IF;

  SELECT count(*) INTO v_pending_count
    FROM public.profile_backfill_jobs j
    JOIN public.cards c ON c.id=j.card_id
   WHERE c.name LIKE 'Stale lease priority pending %'
     AND j.status='pending';

  IF v_pending_count <> 120 THEN
    RAISE EXCEPTION 'pending backlog changed while reclaiming stale lease: %',v_pending_count;
  END IF;
END
$$;

ROLLBACK;
