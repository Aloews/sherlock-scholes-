-- ============================================================
-- SHERLOCK SCHOLES — Supabase Schema v2
-- Generic card deck (10 categories from sherlock_cards.csv)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PLAYERS (Telegram users)
-- ============================================================
CREATE TABLE IF NOT EXISTS players (
  id         BIGINT PRIMARY KEY,            -- Telegram user ID
  username   TEXT,
  first_name TEXT NOT NULL,
  last_name  TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code             CHAR(6) UNIQUE NOT NULL,
  host_id          BIGINT  NOT NULL REFERENCES players(id),
  status           TEXT    NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting', 'playing', 'finished')),
  settings         JSONB   NOT NULL DEFAULT '{"round_seconds":60,"cards_per_round":5,"total_rounds":3,"categories":null}',
  current_round_id UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#22c55e',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROOM PLAYERS
-- ============================================================
CREATE TABLE IF NOT EXISTS room_players (
  id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   UUID    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id BIGINT  NOT NULL REFERENCES players(id),
  team_id   UUID    REFERENCES teams(id),
  is_ready  BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, player_id)
);

-- ============================================================
-- CARDS (generic deck — replaces football_players)
-- ============================================================
CREATE TABLE IF NOT EXISTS cards (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT    NOT NULL,
  category        TEXT    NOT NULL,           -- player | club | term | referee | coach | stadium | club_nickname | commentator | position | woman
  category_ru     TEXT,                       -- localised label stored alongside for display
  difficulty      TEXT    DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  forbidden_words TEXT[]  DEFAULT '{}',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROUNDS
-- ============================================================
CREATE TABLE IF NOT EXISTS rounds (
  id           UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID   NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  team_id      UUID   NOT NULL REFERENCES teams(id),
  explainer_id BIGINT REFERENCES players(id),
  round_number INT    NOT NULL,
  status       TEXT   NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'completed')),
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  time_seconds INT    NOT NULL DEFAULT 60
);

-- Add FK after rounds table exists
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_current_round
  FOREIGN KEY (current_round_id) REFERENCES rounds(id);

-- ============================================================
-- ROUND CARDS
-- ============================================================
CREATE TABLE IF NOT EXISTS round_cards (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  card_id    UUID NOT NULL REFERENCES cards(id),
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'correct', 'skipped')),
  card_order INT  NOT NULL,
  decided_at TIMESTAMPTZ,
  UNIQUE(round_id, card_order)
);

-- ============================================================
-- SCORES
-- ============================================================
CREATE TABLE IF NOT EXISTS scores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id),
  round_id   UUID NOT NULL REFERENCES rounds(id),
  points     INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, round_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rooms_code        ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status      ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_room       ON rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status     ON rounds(room_id, status);
CREATE INDEX IF NOT EXISTS idx_round_cards_round ON round_cards(round_id);
CREATE INDEX IF NOT EXISTS idx_scores_room       ON scores(room_id);
CREATE INDEX IF NOT EXISTS idx_cards_active      ON cards(active, category);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Unique 6-char room code generator
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS CHAR(6) AS $$
DECLARE
  chars  TEXT    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code CHAR(6);
  taken  BOOLEAN;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, (floor(random() * length(chars)) + 1)::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM rooms WHERE rooms.code = v_code) INTO taken;
    EXIT WHEN NOT taken;
  END LOOP;
  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_room_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := generate_room_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_room_code
  BEFORE INSERT ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_room_code();

-- Aggregate scores per team in a room
CREATE OR REPLACE FUNCTION get_room_scores(p_room_id UUID)
RETURNS TABLE(team_id UUID, team_name TEXT, total_points BIGINT) AS $$
BEGIN
  RETURN QUERY
    SELECT t.id, t.name, COALESCE(SUM(s.points), 0)::BIGINT
    FROM teams t
    LEFT JOIN scores s ON s.team_id = t.id AND s.room_id = p_room_id
    WHERE t.room_id = p_room_id
    GROUP BY t.id, t.name
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql;

-- Random card picker — ORDER BY random() runs before LIMIT so every
-- category has a fair chance regardless of disk storage order.
CREATE OR REPLACE FUNCTION pick_random_cards(
  p_count      INT,
  p_categories TEXT[] DEFAULT NULL
)
RETURNS SETOF cards AS $$
BEGIN
  RETURN QUERY
    SELECT *
    FROM cards
    WHERE active = TRUE
      AND (
        p_categories IS NULL
        OR cardinality(p_categories) = 0
        OR category = ANY(p_categories)
      )
    ORDER BY random()
    LIMIT p_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- ROW LEVEL SECURITY (permissive for MVP)
-- ============================================================
ALTER TABLE players     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_players"     ON players     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_rooms"       ON rooms       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_teams"       ON teams       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_room_players" ON room_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cards"       ON cards       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_rounds"      ON rounds      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_round_cards" ON round_cards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_scores"      ON scores      FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE round_cards;
ALTER PUBLICATION supabase_realtime ADD TABLE scores;
