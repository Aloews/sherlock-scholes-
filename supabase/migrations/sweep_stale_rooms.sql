-- ============================================================
-- SHERLOCK SCHOLES — Migration: close abandoned games from the server
--
-- THE BUG THIS FIXES (confirmed on production, 2026-08-02)
--
-- Room 9c5e2e16: round 3 'active' since 18:11:07, no ended_at, room still
-- 'playing'. Another has been stuck the same way since 18 July. Because
-- award_room_stats() hangs off the room reaching 'finished', the second
-- player of that game has NO player_stats row at all — 63 cards guessed,
-- credited nowhere.
--
-- useGame already has a watchdog for the vanishing explainer: every other
-- client schedules an end attempt a few seconds past the deadline. It cannot
-- help here, and no client-side watchdog ever can — it needs a client still
-- running, and in these rooms everyone had closed the app.
--
-- So the sweep lives on the server. Every five minutes it:
--
--   • ends rounds whose deadline passed more than the grace period ago, by
--     calling end_round() — the same transaction a client would have run, so
--     the points are counted and written exactly as in a normal game;
--   • finishes rooms that are still 'playing' with no active round and no
--     movement for the grace period, which credits statistics through
--     trg_award_room_stats.
--
-- THE GRACE PERIOD IS THE SAFETY MARGIN. A live game between rounds is idle
-- for SUMMARY_PAUSE_MS (4 s), and the client watchdogs fire 4–10 s past a
-- deadline. Two minutes is far outside both: if nothing has moved for that
-- long, no client is left to move it. Do not lower it towards those numbers
-- without re-reading roomService.SUMMARY_PAUSE_MS.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- Requires end_round_rpc.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sweep_stale_rooms(p_grace_seconds INT DEFAULT 120)
RETURNS TABLE (rounds_ended INT, rooms_finished INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_round  RECORD;
  v_rounds INT := 0;
  v_rooms  INT := 0;
BEGIN
  -- Overdue rounds. end_round() does the claiming, so a client that wakes up
  -- and ends the same round at the same moment simply wins or loses the race
  -- without either side double-scoring.
  FOR v_round IN
    SELECT r.id
      FROM rounds r
      JOIN rooms ro ON ro.id = r.room_id
     WHERE r.status = 'active'
       AND ro.status = 'playing'
       AND r.started_at IS NOT NULL
       AND r.started_at + make_interval(secs => r.time_seconds + p_grace_seconds) < now()
  LOOP
    PERFORM end_round(v_round.id);
    v_rounds := v_rounds + 1;
  END LOOP;

  -- Rooms nobody is driving any more: still 'playing', no round running, and
  -- nothing has happened for the grace period. Includes the case where the
  -- final round was ended but the client died before closing the room, and
  -- the case where a round was ended by the loop above and no client remains
  -- to deal the next one (that room is closed on the following sweep, which
  -- gives a live client its four seconds to activate the round first).
  WITH stale AS (
    SELECT ro.id
      FROM rooms ro
     WHERE ro.status = 'playing'
       AND NOT EXISTS (
             SELECT 1 FROM rounds r
              WHERE r.room_id = ro.id AND r.status = 'active')
       AND coalesce(
             (SELECT max(r.ended_at) FROM rounds r WHERE r.room_id = ro.id),
             ro.started_at,
             ro.created_at
           ) + make_interval(secs => p_grace_seconds) < now()
  )
  UPDATE rooms ro
     SET status = 'finished', ended_at = now()
    FROM stale
   WHERE ro.id = stale.id;
  GET DIAGNOSTICS v_rooms = ROW_COUNT;

  rounds_ended   := v_rounds;
  rooms_finished := v_rooms;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sweep_stale_rooms(INT) IS
  'Close rounds and rooms abandoned by every client. Scheduled every 5 '
  'minutes by pg_cron; see sweep_stale_rooms.sql.';

-- Deliberately NOT granted to anon/authenticated: unlike end_round(), which a
-- player legitimately calls for their own game, this one walks every room.

-- ─── The scheduler ──────────────────────────────────────────
-- pg_cron was available on this project but not installed (checked before
-- writing this). GitHub Actions is not an alternative: its cron floor is five
-- minutes AND it is not guaranteed — this repository already loses
-- `pull_request` events, per CLAUDE.md.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-running the script must not stack duplicate jobs.
SELECT cron.unschedule('sweep-stale-rooms')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-rooms');

SELECT cron.schedule(
  'sweep-stale-rooms',
  '*/5 * * * *',
  $job$SELECT public.sweep_stale_rooms();$job$
);

-- What ran, and whether it worked:
--   SELECT * FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sweep-stale-rooms')
--    ORDER BY start_time DESC LIMIT 10;
