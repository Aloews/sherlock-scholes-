-- ============================================================
-- SHERLOCK SCHOLES — Migration: end a round in one transaction
--
-- THE BUG THIS FIXES (confirmed on production, 2026-08-02)
--
-- A player scored 63 in round 1 and the screen showed 0:0. The points were
-- never lost — `scores` held 63 and 3. They were READ TOO EARLY.
--
-- The client's endRound() did three things in sequence:
--
--   1. UPDATE rounds SET status='completed'   ← realtime fires HERE
--   2. SELECT round_cards                       (count the correct ones)
--   3. UPSERT scores                          ← the row appears HERE
--
-- and every client, on the event from step 1, immediately fetched the scores.
-- That read lands inside the window between 1 and 3 — two network round-trips
-- wide, on a phone. For the first round the answer is always 0:0. It happens
-- by construction, not occasionally. Timestamps from that game: round marked
-- completed at 18:09:53, score row written at 18:09:53.588.
--
-- THE TRAP: why the steps were not simply reordered
--
-- That status flip is ALSO the atomic claim (`WHERE status='active'`) that
-- stops two clients from scoring the same round twice — the explainer and the
-- watchdog in useGame both call this. Writing the score first and claiming
-- afterwards buys double points instead of a stale zero.
--
-- So the fix is neither order: it is ONE transaction. The claim, the count,
-- the score and the room's finish all commit together, and Postgres emits the
-- realtime event for the `rounds` UPDATE only at COMMIT — by which time the
-- score row is already there for anyone who reacts to it.
--
-- WHAT STAYS ON THE CLIENT
--
-- The summary pause between rounds (SUMMARY_PAUSE_MS) and the deal for the
-- next round. A transaction must not sleep, and dealing cards needs the deck
-- filter the client already holds. end_round() therefore RETURNS the id of
-- the next round instead of activating it.
--
-- SECURITY DEFINER, but note what that does and does not grant: `rounds`,
-- `scores` and `rooms` are all writable by `anon` under the current policies
-- (rls_lockdown.sql covers progression tables, not the room lifecycle), so a
-- client can already do every one of these writes by hand. This function does
-- not widen anything; it makes the sequence atomic.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

-- Returns one of: 'already_ended' | 'next_round' | 'game_end'
--   already_ended — someone else claimed this round; the caller does nothing
--   next_round    — points are written; p_next_round_id is the round to deal
--   game_end      — points are written and the room is 'finished' (which fires
--                   trg_award_room_stats, so statistics are credited in this
--                   same transaction)
CREATE OR REPLACE FUNCTION public.end_round(
  p_round_id UUID,
  OUT outcome TEXT,
  OUT next_round_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room_id      UUID;
  v_team_id      UUID;
  v_round_number INT;
  v_points       INT;
BEGIN
  -- The claim. Exactly one caller matches `status = 'active'`; everyone else
  -- — a double tap, the non-explainer fallback, the server sweep — leaves here.
  UPDATE rounds
     SET status = 'completed', ended_at = now()
   WHERE id = p_round_id AND status = 'active'
  RETURNING room_id, team_id, round_number
    INTO v_room_id, v_team_id, v_round_number;

  IF NOT FOUND THEN
    outcome := 'already_ended';
    RETURN;
  END IF;

  SELECT count(*) INTO v_points
    FROM round_cards
   WHERE round_id = p_round_id AND status = 'correct';

  -- ON CONFLICT on the natural key: scores has UNIQUE (team_id, round_id), so
  -- a re-run of a round that somehow got claimed twice overwrites rather than
  -- adds. It cannot happen through the claim above; it is the honest upsert
  -- the client had.
  INSERT INTO scores (room_id, team_id, round_id, points)
  VALUES (v_room_id, v_team_id, p_round_id, v_points)
  ON CONFLICT (team_id, round_id) DO UPDATE SET points = EXCLUDED.points;

  SELECT r.id INTO next_round_id
    FROM rounds r
   WHERE r.room_id = v_room_id
     AND r.round_number = v_round_number + 1
     AND r.status = 'pending';

  IF next_round_id IS NOT NULL THEN
    outcome := 'next_round';
    RETURN;
  END IF;

  -- Last round. Finishing the room is what credits statistics: the AFTER
  -- UPDATE trigger from award_stats_on_finish.sql runs award_room_stats()
  -- inside this transaction.
  UPDATE rooms
     SET status = 'finished', ended_at = now()
   WHERE id = v_room_id AND status <> 'finished';

  outcome := 'game_end';
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_round(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.end_round(UUID) IS
  'Claim, score and close a round in one transaction, so the realtime event '
  'for the round completing cannot reach a client before the score row '
  'exists. See end_round_rpc.sql for the race it replaces.';

NOTIFY pgrst, 'reload schema';
