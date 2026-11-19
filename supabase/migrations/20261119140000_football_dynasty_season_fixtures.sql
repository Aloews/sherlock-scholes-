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

WITH player_clubs AS (
  SELECT DISTINCT ON (cl.campaign_id)
    cl.campaign_id, cl.name AS player_team, c.current_year, c.game_date
  FROM fd.clubs cl
  JOIN fd.campaigns c ON c.id=cl.campaign_id
  ORDER BY cl.campaign_id, cl.created_at, cl.id
), schedule(matchday, home_slot, away_slot) AS (
  VALUES
    (1, 'player', 'Harbor Athletic'),
    (1, 'Redbridge FC', 'Kingsport United'),
    (2, 'Kingsport United', 'player'),
    (2, 'Harbor Athletic', 'Redbridge FC'),
    (3, 'player', 'Redbridge FC'),
    (3, 'Kingsport United', 'Harbor Athletic'),
    (4, 'Harbor Athletic', 'player'),
    (4, 'Kingsport United', 'Redbridge FC'),
    (5, 'Redbridge FC', 'player'),
    (5, 'Harbor Athletic', 'Kingsport United'),
    (6, 'player', 'Kingsport United'),
    (6, 'Redbridge FC', 'Harbor Athletic')
)
INSERT INTO fd.season_fixtures
  (campaign_id, season_year, matchday, match_date, home_team, away_team)
SELECT
  pc.campaign_id,
  pc.current_year,
  schedule.matchday,
  pc.game_date + ((6 - EXTRACT(ISODOW FROM pc.game_date)::integer + 7) % 7) + ((schedule.matchday::integer - 1) * 7),
  CASE WHEN schedule.home_slot = 'player' THEN pc.player_team ELSE schedule.home_slot END,
  CASE WHEN schedule.away_slot = 'player' THEN pc.player_team ELSE schedule.away_slot END
FROM player_clubs pc
CROSS JOIN schedule
ON CONFLICT (campaign_id, season_year, matchday, home_team, away_team) DO NOTHING;

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
