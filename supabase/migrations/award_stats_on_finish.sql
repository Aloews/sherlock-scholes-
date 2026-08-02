-- ============================================================
-- SHERLOCK SCHOLES — Migration: credit statistics when the room finishes
--
-- Statistics used to be credited by whichever client happened to end the
-- game: endRound() flipped the room to 'finished' and then called
-- updatePlayerStats() WITHOUT awaiting it. Four more round-trips had to
-- complete on a phone that had, at that exact moment, been told to navigate
-- to the results screen. Close Telegram there and the game is scored for
-- nobody, permanently, with no way to notice.
--
-- It also had the client decide who won, from data it fetched itself, after
-- being told the game was over.
--
-- The crediting now lives in ONE function, award_room_stats(room_id), which
-- is called from two places:
--
--   • a BEFORE UPDATE trigger on rooms — the normal path, inside the same
--     transaction that marks the room finished, so it cannot be lost;
--   • an RPC the client may still call — a harmless retry.
--
-- Both are guarded by rooms.stats_awarded_at, so whichever runs first wins
-- and the other does nothing. That matters because the trigger and the old
-- client cannot be deployed at the same instant: without the guard, applying
-- this migration before the frontend ships would double every counter, and
-- shipping the frontend first would credit nothing until the migration ran.
-- With it, either order is safe.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS stats_awarded_at TIMESTAMPTZ;

COMMENT ON COLUMN rooms.stats_awarded_at IS
  'When this room was scored. NULL = never. Makes crediting exactly-once '
  'across the trigger and the client RPC; see award_stats_on_finish.sql.';

-- ─── The one definition ─────────────────────────────────────
-- Returns true when it credited, false when the room was already scored.
CREATE OR REPLACE FUNCTION public.award_room_stats(p_room_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_points INT;
  v_claimed    INT;
BEGIN
  -- Claim the room first, atomically. Two concurrent callers both reach the
  -- UPDATE; only one matches `stats_awarded_at IS NULL`, so only one credits.
  UPDATE rooms SET stats_awarded_at = now()
  WHERE id = p_room_id AND stats_awarded_at IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  -- Highest team total. 0 means nobody scored, and then nobody won — a 0:0
  -- game must not hand every team a victory.
  SELECT coalesce(max(pts), 0) INTO v_max_points
  FROM (
    SELECT sum(s.points) AS pts
    FROM scores s WHERE s.room_id = p_room_id GROUP BY s.team_id
  ) t;

  -- One increment_player_stats() call per member, with the three inputs the
  -- client used to assemble by hand:
  --   cards_guessed — cards marked correct in the rounds THIS player explained
  --   total_score   — their team's points
  --   games_won     — their team tied for the top score, and that score > 0
  PERFORM increment_player_stats(
            rp.player_id,
            1,
            CASE WHEN tp.pts = v_max_points AND v_max_points > 0 THEN 1 ELSE 0 END,
            coalesce(g.cards, 0)::int,
            coalesce(tp.pts, 0)::int)
  FROM room_players rp
  LEFT JOIN (
    SELECT s.team_id, sum(s.points) AS pts
    FROM scores s WHERE s.room_id = p_room_id GROUP BY s.team_id
  ) tp ON tp.team_id = rp.team_id
  LEFT JOIN (
    SELECT r.explainer_id, count(*) AS cards
    FROM rounds r
    JOIN round_cards rc ON rc.round_id = r.id
    WHERE r.room_id = p_room_id AND rc.status = 'correct' AND r.explainer_id IS NOT NULL
    GROUP BY r.explainer_id
  ) g ON g.explainer_id = rp.player_id
  WHERE rp.room_id = p_room_id;

  RETURN TRUE;
END;
$$;

-- ─── Path 1: the room finishing ─────────────────────────────
-- AFTER, not BEFORE: award_room_stats() updates `rooms` itself, which a
-- BEFORE trigger on the same row cannot do cleanly. The WHEN clause fires it
-- only on the transition INTO 'finished', and the function's own claim stops
-- the recursive UPDATE from doing anything the second time round.
CREATE OR REPLACE FUNCTION public.on_room_finished()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM award_room_stats(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_room_stats ON rooms;
CREATE TRIGGER trg_award_room_stats
  AFTER UPDATE OF status ON rooms
  FOR EACH ROW
  WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished')
  EXECUTE FUNCTION on_room_finished();

-- ─── Path 2: the client's retry ─────────────────────────────
-- The frontend keeps calling this after a game ends. Once the trigger is
-- live it is always a no-op, but it costs one request and it means an older
-- build still scores its games correctly.
GRANT EXECUTE ON FUNCTION public.award_room_stats(UUID) TO anon, authenticated;

-- Rooms that finished before this migration are deliberately NOT backfilled:
-- most were credited by the old client path, and replaying them would double
-- every counter. They are left with stats_awarded_at NULL, so calling
-- award_room_stats(id) on one credits it — use that for a specific game.

NOTIFY pgrst, 'reload schema';
