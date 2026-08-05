-- ============================================================
-- SHERLOCK SCHOLES — Migration: friends, and who to add
--
-- Two tables and four functions behind one idea: the people worth playing
-- with again are the people you already played with. Nothing here asks the
-- player to search for anybody — the game knows who was in the room.
--
--   player_encounters  who played with whom, and how often
--   friendships        who the player chose to keep
--
-- WHY ENCOUNTERS ARE RECORDED BY THE SERVER. The same reason statistics are
-- (award_stats_on_finish.sql): the client that ends a game is the client that
-- is being navigated away at that exact moment, and anything it was asked to
-- do afterwards is lost. This hangs on the room finishing, in the same
-- transaction, with its own exactly-once claim.
--
-- WHY THE CLAIM IS SEPARATE FROM stats_awarded_at. Replaying encounters would
-- inflate `games`, so it needs its own guard — and sharing the stats claim
-- would couple two migrations that are otherwise independent. One extra
-- column is cheaper than that coupling.
--
-- SECURITY. Both tables have RLS enabled and NO policies at all: nothing
-- reaches them except the SECURITY DEFINER functions below. Reads take a
-- player id, which any client may claim — the same trust model the rest of
-- this schema already has (increment_player_stats). Writes do NOT: adding or
-- removing a friend derives the caller from Telegram's signed initData via
-- get_user_status(), so one player cannot edit another's list.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS encounters_recorded_at TIMESTAMPTZ;

COMMENT ON COLUMN rooms.encounters_recorded_at IS
  'When this room''s co-players were recorded. NULL = never. Makes recording '
  'exactly-once; see friends_and_rating.sql.';

-- ─── Tables ─────────────────────────────────────────────────

-- Symmetric by construction: a finished room writes both directions, so
-- "who did I play with" is one index lookup rather than an OR across columns.
CREATE TABLE IF NOT EXISTS public.player_encounters (
  player_id    BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  other_id     BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  games        INTEGER     NOT NULL DEFAULT 0,
  last_game_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, other_id),
  CONSTRAINT player_encounters_not_self CHECK (player_id <> other_id)
);

-- One-way on purpose: this is "my list", not a mutual pact. A request/accept
-- flow needs a notification channel to be worth anything, and the game does
-- not have one yet — adding it later does not invalidate these rows.
CREATE TABLE IF NOT EXISTS public.friendships (
  player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_id),
  CONSTRAINT friendships_not_self CHECK (player_id <> friend_id)
);

ALTER TABLE public.player_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships       ENABLE ROW LEVEL SECURITY;

-- ─── Recording who played with whom ─────────────────────────

CREATE OR REPLACE FUNCTION public.record_room_encounters(p_room_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claimed INT;
BEGIN
  -- Claim first, atomically: two callers race, one wins, the other does
  -- nothing. Same shape as award_room_stats().
  UPDATE rooms SET encounters_recorded_at = now()
  WHERE id = p_room_id AND encounters_recorded_at IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO player_encounters AS pe (player_id, other_id, games, last_game_at)
  SELECT a.player_id, b.player_id, 1, now()
  FROM room_players a
  JOIN room_players b ON b.room_id = a.room_id AND b.player_id <> a.player_id
  WHERE a.room_id = p_room_id
  ON CONFLICT (player_id, other_id)
  DO UPDATE SET games = pe.games + 1, last_game_at = now();

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_room_finished_encounters()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM record_room_encounters(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_encounters ON rooms;
CREATE TRIGGER trg_record_encounters
  AFTER UPDATE OF status ON rooms
  FOR EACH ROW
  WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished')
  EXECUTE FUNCTION on_room_finished_encounters();

-- ─── Reading: the list, and who to add ──────────────────────

-- The rating axis is `xp`, the one the profile already shows. Inventing a
-- second number here would give the same player two different standings.
CREATE OR REPLACE FUNCTION public.friends_with_rating(p_player_id BIGINT)
RETURNS TABLE (
  player_id      BIGINT,
  first_name     TEXT,
  last_name      TEXT,
  username       TEXT,
  avatar_url     TEXT,
  xp             INTEGER,
  games_played   INTEGER,
  games_won      INTEGER,
  cards_guessed  INTEGER,
  games_together INTEGER
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.first_name, p.last_name, p.username, p.avatar_url,
         coalesce(s.xp, 0), coalesce(s.games_played, 0), coalesce(s.games_won, 0),
         coalesce(s.cards_guessed, 0), coalesce(e.games, 0)
  FROM friendships f
  JOIN players p            ON p.id = f.friend_id
  LEFT JOIN player_stats s  ON s.player_id = f.friend_id
  LEFT JOIN player_encounters e
         ON e.player_id = f.player_id AND e.other_id = f.friend_id
  WHERE f.player_id = p_player_id
  ORDER BY coalesce(s.xp, 0) DESC, coalesce(e.games, 0) DESC, p.first_name;
$$;

-- Co-players who are not friends yet, most-played first. Deliberately not
-- "people you may know": every row here is somebody the player actually
-- shared a room with, which is the only relationship this game can prove.
CREATE OR REPLACE FUNCTION public.friend_suggestions(
  p_player_id BIGINT,
  p_limit     INTEGER DEFAULT 10
)
RETURNS TABLE (
  player_id      BIGINT,
  first_name     TEXT,
  last_name      TEXT,
  username       TEXT,
  avatar_url     TEXT,
  xp             INTEGER,
  games_together INTEGER,
  last_game_at   TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.first_name, p.last_name, p.username, p.avatar_url,
         coalesce(s.xp, 0), e.games, e.last_game_at
  FROM player_encounters e
  JOIN players p           ON p.id = e.other_id
  LEFT JOIN player_stats s ON s.player_id = e.other_id
  WHERE e.player_id = p_player_id
    AND NOT EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.player_id = p_player_id AND f.friend_id = e.other_id
    )
  ORDER BY e.games DESC, e.last_game_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ─── Writing: the caller is whoever Telegram signed for ─────
-- p_init_data is NOT a player id. get_user_status() checks the HMAC against
-- the bot token and raises on a forgery, so a client can only edit its own
-- list — see supabase/functions/livekit-token/README.md for the same idea.

CREATE OR REPLACE FUNCTION public.add_friend(p_init_data TEXT, p_friend_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me BIGINT;
BEGIN
  v_me := (get_user_status(p_init_data) ->> 'telegram_id')::BIGINT;
  IF v_me IS NULL OR v_me = p_friend_id THEN
    RETURN FALSE;
  END IF;

  INSERT INTO friendships (player_id, friend_id)
  VALUES (v_me, p_friend_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend(p_init_data TEXT, p_friend_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me BIGINT;
BEGIN
  v_me := (get_user_status(p_init_data) ->> 'telegram_id')::BIGINT;
  IF v_me IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM friendships WHERE player_id = v_me AND friend_id = p_friend_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.friends_with_rating(BIGINT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.friend_suggestions(BIGINT, INTEGER)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_friend(TEXT, BIGINT)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(TEXT, BIGINT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_room_encounters(UUID)         TO anon, authenticated;

-- Rooms that finished before this migration are NOT backfilled here: the
-- history is in room_players and can be replayed at any time with
--   SELECT record_room_encounters(id) FROM rooms WHERE status = 'finished';
-- which is safe to run once — the claim column stops a second pass.

NOTIFY pgrst, 'reload schema';
