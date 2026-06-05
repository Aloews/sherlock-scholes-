-- ============================================================
-- SHERLOCK SCHOLES — Migration: players_meta + player_seasons
-- New tables for a future players database keyed by league/season.
-- Does NOT touch `cards`, game logic, or any existing data.
-- Run manually in the Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- PLAYERS META (canonical player identities)
-- ============================================================
CREATE TABLE IF NOT EXISTS players_meta (
  id              BIGSERIAL PRIMARY KEY,
  wikidata_qid    TEXT   UNIQUE,
  api_football_id BIGINT UNIQUE,
  name_en         TEXT   NOT NULL,
  name_ru         TEXT,
  name_source     TEXT,
  name_confidence TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PLAYER SEASONS (per-league, per-season popularity metrics)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_seasons (
  id                    BIGSERIAL PRIMARY KEY,
  player_id             BIGINT REFERENCES players_meta(id),
  league                TEXT NOT NULL,
  season                INT  NOT NULL,
  popularity_rank       INT,
  popularity_score      NUMERIC,
  pageviews             BIGINT,
  market_value_eur      BIGINT,
  minutes_share         NUMERIC,
  play_level            NUMERIC,
  popularity_confidence TEXT,
  UNIQUE (player_id, league, season)
);

-- ============================================================
-- ROW LEVEL SECURITY (same permissive MVP pattern as other tables)
-- ============================================================
ALTER TABLE players_meta   ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_players_meta"   ON players_meta   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_player_seasons" ON player_seasons FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON players_meta   TO anon;
GRANT ALL ON players_meta   TO authenticated;
GRANT ALL ON player_seasons TO anon;
GRANT ALL ON player_seasons TO authenticated;

-- BIGSERIAL sequences need explicit grants for anon/authenticated inserts
GRANT USAGE, SELECT ON SEQUENCE players_meta_id_seq   TO anon;
GRANT USAGE, SELECT ON SEQUENCE players_meta_id_seq   TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE player_seasons_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE player_seasons_id_seq TO authenticated;
