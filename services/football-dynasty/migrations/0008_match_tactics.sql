ALTER TABLE fd.season_fixtures
  ADD COLUMN player_tactic text NOT NULL DEFAULT 'balanced'
  CHECK (player_tactic IN ('balanced','attacking','defensive'));
