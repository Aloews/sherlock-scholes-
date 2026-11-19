CREATE TABLE fd.season_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  matchday smallint NOT NULL CHECK (matchday BETWEEN 1 AND 38),
  match_date date NOT NULL,
  home_team text NOT NULL CHECK (char_length(home_team) BETWEEN 1 AND 80),
  away_team text NOT NULL CHECK (char_length(away_team) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','played')),
  home_goals smallint CHECK (home_goals BETWEEN 0 AND 20),
  away_goals smallint CHECK (away_goals BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team <> away_team),
  CHECK (
    (status = 'scheduled' AND home_goals IS NULL AND away_goals IS NULL)
    OR (status = 'played' AND home_goals IS NOT NULL AND away_goals IS NOT NULL)
  ),
  UNIQUE (campaign_id, season_year, matchday, home_team, away_team)
);

CREATE INDEX fd_season_fixtures_calendar_idx
  ON fd.season_fixtures(campaign_id, season_year, match_date, matchday);

ALTER TABLE fd.season_fixtures ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.season_fixtures
  FOR ALL TO fd_runtime
  USING (EXISTS (
    SELECT 1 FROM fd.campaigns c
    WHERE c.id = campaign_id
      AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fd.campaigns c
    WHERE c.id = campaign_id
      AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
  ));

GRANT SELECT, INSERT, UPDATE ON fd.season_fixtures TO fd_runtime;
