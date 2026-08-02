-- ============================================================
-- SHERLOCK SCHOLES — Migration: weekly quests (progression phase 4)
--
-- Weekly, not daily, and the SAME three tasks for everyone — so there is no
-- per-player assignment table and no cron job to hand tasks out. The week's
-- set is DERIVED from the week itself by weekly_task_codes(), and every
-- consumer goes through that one function:
--
--   increment_player_stats()  credits progress to the current week's tasks
--   get_weekly_quests()       tells the client what to draw
--   claim_weekly_task()       pays the reward out
--
-- The client is told the answer, it never computes it. That is deliberate,
-- the same rule the deck follows (one SQL predicate, see deck_rpc.sql): if
-- the rotation existed in TypeScript too, the tasks a player sees and the
-- tasks their play credits could drift apart.
--
-- The week starts Monday 00:00 UTC. UTC and not the player's local time
-- because a player who travels must not get a second Monday, and because
-- the client cannot be trusted to report its own timezone honestly.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================

-- ─── 0. Dependency this migration cannot assume ─────────────
-- increment_player_stats() below writes player_stats.xp, which
-- player_progression_xp.sql adds. Applying THIS file without that one left
-- production with a function referencing a column that did not exist: every
-- call raised "column xp does not exist", so nothing was credited at all —
-- not quests, not xp, not even games_played. The game looked fine; the
-- statistics silently stopped.
--
-- A migration must not depend on another having been run by hand. Adding the
-- column here is idempotent and makes this file safe on its own.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

-- ─── 1. Catalogue ───────────────────────────────────────────
-- `metric` names the counter this task watches; it must match a column that
-- increment_player_stats() already receives, so a task can never ask for
-- something the game does not measure.
CREATE TABLE IF NOT EXISTS weekly_tasks (
  code       TEXT PRIMARY KEY,
  metric     TEXT    NOT NULL CHECK (metric IN ('cards_guessed', 'games_played', 'games_won')),
  target     INTEGER NOT NULL CHECK (target > 0),
  reward_xp  INTEGER NOT NULL CHECK (reward_xp > 0),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE weekly_tasks IS
  'Catalogue of weekly quests. Labels are NOT stored here — the app has nine '
  'languages, so the client renders t(''quests.metric.<metric>'', {count: target}).';

-- Six tasks, three shown per week. Two of each metric at different sizes, so
-- any week's rotation mixes an easy and a hard one.
INSERT INTO weekly_tasks (code, metric, target, reward_xp, sort_order) VALUES
  ('guess_50',      'cards_guessed',  50, 150, 1),
  ('play_5_games',  'games_played',    5, 100, 2),
  ('win_3_games',   'games_won',       3, 200, 3),
  ('guess_100',     'cards_guessed', 100, 300, 4),
  ('play_10_games', 'games_played',   10, 250, 5),
  ('win_5_games',   'games_won',       5, 350, 6)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Progress ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_weekly_tasks (
  player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  task_code  TEXT        NOT NULL REFERENCES weekly_tasks(code) ON DELETE CASCADE,
  week_start DATE        NOT NULL,
  progress   INTEGER     NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY (player_id, task_code, week_start)
);

CREATE INDEX IF NOT EXISTS player_weekly_tasks_lookup
  ON player_weekly_tasks (player_id, week_start);

-- ─── 3. The week, and the week's tasks ──────────────────────
-- Monday of the week containing p_at, in UTC. date_trunc('week') is already
-- Monday-based in Postgres; this wrapper exists so the rule is named once.
CREATE OR REPLACE FUNCTION public.current_week_start(p_at TIMESTAMPTZ DEFAULT NOW())
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('week', p_at AT TIME ZONE 'UTC'))::date;
$$;

-- The three codes for a given week. Deterministic: the same week always
-- yields the same three, for every player, with no stored assignment.
--
-- The window slides by one each week rather than jumping by three, so a task
-- that was hard this week reappears soon enough to feel reachable, and the
-- six-task catalogue does not partition into two fixed trios.
CREATE OR REPLACE FUNCTION public.weekly_task_codes(p_week_start DATE)
RETURNS TABLE (code TEXT) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_n     INT;
  v_shift INT;
BEGIN
  SELECT count(*) INTO v_n FROM weekly_tasks WHERE active;
  IF v_n = 0 THEN
    RETURN;
  END IF;

  -- Whole weeks since the epoch — an integer that advances by exactly one
  -- per week and never resets at a year boundary the way ISO week numbers do.
  v_shift := (p_week_start - DATE '1970-01-05') / 7;  -- 1970-01-05 was a Monday

  RETURN QUERY
  WITH ordered AS (
    SELECT w.code, (row_number() OVER (ORDER BY w.sort_order, w.code) - 1) AS idx
    FROM weekly_tasks w
    WHERE w.active
  )
  SELECT o.code
  FROM ordered o
  WHERE (o.idx - v_shift + v_n * 1000) % v_n < LEAST(3, v_n)
  ORDER BY o.idx;
END;
$$;

-- ─── 4. Crediting progress ──────────────────────────────────
-- Folded into the call the room-end flow already makes, for the same reason
-- XP was (player_progression_xp.sql): the amounts are derived here from
-- game-outcome inputs the function already trusts, so progress cannot be
-- forged by calling a separate "add progress" endpoint from the console.
CREATE OR REPLACE FUNCTION increment_player_stats(
  p_player_id     BIGINT,
  p_games_played  INT DEFAULT 1,
  p_games_won     INT DEFAULT 0,
  p_cards_guessed INT DEFAULT 0,
  p_total_score   INT DEFAULT 0
) RETURNS VOID AS $$
DECLARE
  v_xp_gained INT  := p_cards_guessed * 10 + p_games_won * 50;
  v_week      DATE := current_week_start();
BEGIN
  INSERT INTO player_stats (player_id, games_played, games_won, cards_guessed, total_score, xp)
  VALUES (p_player_id, p_games_played, p_games_won, p_cards_guessed, p_total_score, v_xp_gained)
  ON CONFLICT (player_id) DO UPDATE SET
    games_played  = player_stats.games_played  + EXCLUDED.games_played,
    games_won     = player_stats.games_won     + EXCLUDED.games_won,
    cards_guessed = player_stats.cards_guessed + EXCLUDED.cards_guessed,
    total_score   = player_stats.total_score   + EXCLUDED.total_score,
    xp            = player_stats.xp            + EXCLUDED.xp,
    updated_at    = NOW();

  -- Credit only THIS week's tasks, and only the metric each one watches.
  -- Progress is capped at the target so a blowout game cannot bank credit
  -- against next week's rotation.
  INSERT INTO player_weekly_tasks (player_id, task_code, week_start, progress)
  SELECT
    p_player_id,
    t.code,
    v_week,
    LEAST(
      t.target,
      CASE t.metric
        WHEN 'cards_guessed' THEN p_cards_guessed
        WHEN 'games_played'  THEN p_games_played
        WHEN 'games_won'     THEN p_games_won
      END
    )
  FROM weekly_tasks t
  WHERE t.code IN (SELECT code FROM weekly_task_codes(v_week))
  ON CONFLICT (player_id, task_code, week_start) DO UPDATE SET
    progress = LEAST(
      (SELECT target FROM weekly_tasks WHERE code = EXCLUDED.task_code),
      player_weekly_tasks.progress + EXCLUDED.progress
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── 5. Reading ─────────────────────────────────────────────
-- One row per task of the current week, with this player's progress. Returns
-- the week's tasks even when the player has never played — progress 0 — so
-- the screen has something to draw on a first visit.
CREATE OR REPLACE FUNCTION public.get_weekly_quests(p_player_id BIGINT)
RETURNS TABLE (
  code       TEXT,
  metric     TEXT,
  target     INTEGER,
  reward_xp  INTEGER,
  progress   INTEGER,
  claimed_at TIMESTAMPTZ,
  week_start DATE
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    t.code,
    t.metric,
    t.target,
    t.reward_xp,
    COALESCE(p.progress, 0),
    p.claimed_at,
    current_week_start()
  FROM weekly_tasks t
  JOIN weekly_task_codes(current_week_start()) c ON c.code = t.code
  LEFT JOIN player_weekly_tasks p
         ON p.task_code  = t.code
        AND p.player_id  = p_player_id
        AND p.week_start = current_week_start()
  ORDER BY t.sort_order, t.code;
$$;

-- ─── 6. Claiming ────────────────────────────────────────────
-- Pays a finished task out exactly once. The guard is the WHERE clause, not
-- a prior SELECT: two taps racing each other both run the UPDATE, but only
-- the first matches `claimed_at IS NULL` and so only one awards XP.
CREATE OR REPLACE FUNCTION public.claim_weekly_task(
  p_player_id BIGINT,
  p_task_code TEXT
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_week   DATE := current_week_start();
  v_reward INT;
BEGIN
  -- Not one of this week's tasks — nothing to claim, whatever the client says.
  IF NOT EXISTS (SELECT 1 FROM weekly_task_codes(v_week) WHERE code = p_task_code) THEN
    RETURN 0;
  END IF;

  SELECT t.reward_xp INTO v_reward
  FROM weekly_tasks t WHERE t.code = p_task_code;

  UPDATE player_weekly_tasks pwt
     SET claimed_at = NOW()
   WHERE pwt.player_id  = p_player_id
     AND pwt.task_code  = p_task_code
     AND pwt.week_start = v_week
     AND pwt.claimed_at IS NULL
     AND pwt.progress  >= (SELECT target FROM weekly_tasks WHERE code = p_task_code);

  IF NOT FOUND THEN
    RETURN 0;   -- unfinished, already claimed, or never started
  END IF;

  UPDATE player_stats
     SET xp = xp + v_reward, updated_at = NOW()
   WHERE player_id = p_player_id;

  RETURN v_reward;
END;
$$;

-- ─── 7. RLS ─────────────────────────────────────────────────
-- Same shape as the rest of the schema (rls_lockdown.sql): the catalogue is
-- public to read, a player's progress is NOT writable from the client — it
-- moves only through the SECURITY DEFINER functions above. Without this a
-- player could UPDATE their own progress to the target and claim every
-- reward from the browser console.
ALTER TABLE weekly_tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_weekly_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_tasks_public_select"        ON weekly_tasks;
DROP POLICY IF EXISTS "player_weekly_tasks_public_select" ON player_weekly_tasks;

CREATE POLICY "weekly_tasks_public_select" ON weekly_tasks
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "player_weekly_tasks_public_select" ON player_weekly_tasks
  FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON weekly_tasks        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON player_weekly_tasks FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_weekly_quests(BIGINT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_weekly_task(BIGINT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
