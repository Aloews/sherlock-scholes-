-- ============================================================
-- SHERLOCK SCHOLES — player history schema (for --collect-history)
-- Run BEFORE the paid mass collection. Idempotent.
--
-- player_career : one row per (player, season, club) — minutes/goals/apps,
--                 the full per-season breakdown the free-tier cache could
--                 not hold. cards.clubs_minutes is later regenerated from
--                 this (summed by club, fuller than 2022-2024).
-- players_meta  : transfers / trophies JSONB + a resume marker.
-- ============================================================

CREATE TABLE IF NOT EXISTS player_career (
  api_football_id BIGINT NOT NULL,
  season          INT    NOT NULL,
  league          TEXT,
  league_id       INT,
  club            TEXT   NOT NULL,
  club_id         INT    NOT NULL,
  minutes         INT    DEFAULT 0,
  appearances     INT    DEFAULT 0,
  goals           INT    DEFAULT 0,
  assists         INT    DEFAULT 0,
  position        TEXT,
  PRIMARY KEY (api_football_id, season, club_id, league_id)
);
CREATE INDEX IF NOT EXISTS idx_player_career_api_id
  ON player_career(api_football_id);

ALTER TABLE players_meta ADD COLUMN IF NOT EXISTS transfers JSONB;
ALTER TABLE players_meta ADD COLUMN IF NOT EXISTS trophies JSONB;
-- Resume marker: set when a player's history finished collecting; the mode
-- skips players whose marker is set unless run with --refresh.
ALTER TABLE players_meta ADD COLUMN IF NOT EXISTS history_collected_at TIMESTAMPTZ;

GRANT SELECT, INSERT, UPDATE, DELETE ON player_career TO service_role;
GRANT SELECT ON player_career TO anon, authenticated;
ALTER TABLE player_career ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_career_public_select" ON player_career;
CREATE POLICY "player_career_public_select" ON player_career
  FOR SELECT TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
