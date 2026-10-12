-- Remove abandoned lobby rooms after three minutes without a second player.
-- A room is eligible only while waiting and while no non-host participant
-- has joined. Playing/finished rooms and rooms with another participant remain.
CREATE OR REPLACE FUNCTION public.delete_unjoined_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.rooms AS ro
   WHERE ro.status = 'waiting'
     AND ro.created_at <= now() - interval '3 minutes'
     AND NOT EXISTS (
       SELECT 1
         FROM public.room_players AS rp
        WHERE rp.room_id = ro.id
          AND rp.player_id <> ro.host_id
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

COMMENT ON FUNCTION public.delete_unjoined_rooms() IS
  'Delete waiting rooms older than three minutes when no non-host player has joined. Runs every minute via pg_cron.';

-- The function walks every room, so only the database scheduler should call it.
REVOKE ALL ON FUNCTION public.delete_unjoined_rooms() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_unjoined_rooms() FROM anon;
REVOKE ALL ON FUNCTION public.delete_unjoined_rooms() FROM authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job
     WHERE jobname = 'delete-unjoined-rooms-every-minute'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'delete-unjoined-rooms-every-minute',
    '* * * * *',
    'SELECT public.delete_unjoined_rooms();'
  );
END;
$schedule$;
