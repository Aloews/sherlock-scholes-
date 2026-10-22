-- Enqueue only approved photo sources in strict priority order: Wikidata, then Transfermarkt.
-- Legacy Soccer Wiki jobs and existing photos are retained; no cards are deleted or cleared.
CREATE OR REPLACE FUNCTION public.enqueue_profile_backfill_jobs(p_limit integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100000' USING errcode = '22023';
  END IF;

  WITH raw_candidates AS (
    SELECT c.id AS card_id, 'photo_qid'::text AS task_type,
           c.transfermarkt_id::text AS transfermarkt_id,
           c.wikidata_qid::text AS wikidata_qid,
           coalesce(c.market_value_eur, 0)::numeric + 1500000000 AS priority
      FROM public.cards c
     WHERE c.category = 'player' AND c.active IS TRUE
       AND NULLIF(BTRIM(c.photo_url), '') IS NULL
       AND NULLIF(BTRIM(c.wikidata_qid::text), '') IS NOT NULL
    UNION ALL
    SELECT c.id, 'photo_tm', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur, 0)::numeric + 1000000000
      FROM public.cards c
     WHERE c.category = 'player' AND c.active IS TRUE
       AND NULLIF(BTRIM(c.photo_url), '') IS NULL
       AND NULLIF(BTRIM(c.transfermarkt_id::text), '') IS NOT NULL
    UNION ALL
    SELECT c.id, 'season_stats', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur, 0)::numeric
      FROM public.cards c
     WHERE c.category = 'player' AND c.active IS TRUE
       AND NULLIF(BTRIM(c.transfermarkt_id::text), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.player_season_stat s
          WHERE s.tm_player_id = c.transfermarkt_id::text
       )
  ), candidates AS (
    SELECT DISTINCT ON (card_id, task_type)
           card_id, task_type, transfermarkt_id, wikidata_qid, priority
      FROM raw_candidates
     ORDER BY card_id, task_type, priority DESC
  ), eligible AS (
    SELECT c.*
      FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profile_backfill_jobs j
        WHERE j.card_id = c.card_id AND j.task_type = c.task_type
          AND (
            j.status IN ('pending', 'running')
            OR (j.status = 'succeeded' AND j.updated_at > now() - interval '30 days')
            OR (
              j.status = 'no_data'
              AND coalesce(j.last_error, '') NOT LIKE 'Transfermarkt photo collector skips cards linked to Soccer Wiki%'
              AND j.updated_at > now() - interval '7 days'
            )
            OR (
              j.status = 'failed'
              AND j.updated_at > now() - interval '7 days'
            )
          )
     )
  ), limited AS (
    SELECT * FROM eligible
     ORDER BY priority DESC, card_id, task_type
     LIMIT p_limit
  ), inserted AS (
    INSERT INTO public.profile_backfill_jobs
      (card_id, task_type, transfermarkt_id, wikidata_qid, priority)
    SELECT card_id, task_type, transfermarkt_id, wikidata_qid, priority FROM limited
    ON CONFLICT (card_id, task_type) DO UPDATE
      SET status = 'pending', attempts = 0, max_attempts = 3,
          last_error = NULL, verified_at = NULL, priority = excluded.priority,
          transfermarkt_id = excluded.transfermarkt_id,
          wikidata_qid = excluded.wikidata_qid, updated_at = now()
      WHERE profile_backfill_jobs.status IN ('no_data', 'failed', 'succeeded')
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

-- Reprioritize existing pending work without deleting or resetting any task.
UPDATE public.profile_backfill_jobs j
   SET priority = coalesce(c.market_value_eur, 0)::numeric
                  + CASE j.task_type
                      WHEN 'photo_qid' THEN 1500000000
                      WHEN 'photo_tm' THEN 1000000000
                      ELSE 0
                    END,
       updated_at = now()
  FROM public.cards c
 WHERE c.id = j.card_id
   AND j.status = 'pending'
   AND j.task_type IN ('photo_qid', 'photo_tm');
