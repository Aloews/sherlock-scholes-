-- Persist campaign squads, tactical defaults, matchday lineups and player events.
CREATE TABLE fd.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  club_id uuid,
  is_player_controlled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id,id),
  UNIQUE (campaign_id,name),
  FOREIGN KEY (campaign_id,club_id) REFERENCES fd.clubs(campaign_id,id)
);

CREATE TABLE fd.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  position text NOT NULL CHECK (position IN ('goalkeeper','defender','midfielder','forward')),
  shirt_number smallint NOT NULL CHECK (shirt_number BETWEEN 1 AND 99),
  age smallint NOT NULL CHECK (age BETWEEN 15 AND 45),
  pace smallint NOT NULL CHECK (pace BETWEEN 0 AND 100),
  shooting smallint NOT NULL CHECK (shooting BETWEEN 0 AND 100),
  passing smallint NOT NULL CHECK (passing BETWEEN 0 AND 100),
  defending smallint NOT NULL CHECK (defending BETWEEN 0 AND 100),
  physical smallint NOT NULL CHECK (physical BETWEEN 0 AND 100),
  goalkeeping smallint NOT NULL CHECK (goalkeeping BETWEEN 0 AND 100),
  stamina smallint NOT NULL CHECK (stamina BETWEEN 0 AND 100),
  morale smallint NOT NULL DEFAULT 65 CHECK (morale BETWEEN 0 AND 100),
  fatigue smallint NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  potential smallint NOT NULL CHECK (potential BETWEEN 0 AND 100),
  market_value_minor bigint NOT NULL DEFAULT 0 CHECK (market_value_minor >= 0),
  wage_minor bigint NOT NULL DEFAULT 0 CHECK (wage_minor >= 0),
  contract_until date,
  injured_until date,
  suspended_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id,id),
  UNIQUE (campaign_id,team_id,shirt_number),
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id)
);

CREATE TABLE fd.team_tactics (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  formation text NOT NULL DEFAULT '4-3-3' CHECK (formation IN ('4-3-3','4-4-2','3-5-2','4-2-3-1','3-4-3')),
  pressing smallint NOT NULL DEFAULT 50 CHECK (pressing BETWEEN 0 AND 100),
  tempo smallint NOT NULL DEFAULT 50 CHECK (tempo BETWEEN 0 AND 100),
  width smallint NOT NULL DEFAULT 50 CHECK (width BETWEEN 0 AND 100),
  attacking_intent smallint NOT NULL DEFAULT 50 CHECK (attacking_intent BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,team_id),
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id)
);

ALTER TABLE fd.season_fixtures
  ADD CONSTRAINT fd_season_fixtures_campaign_id_unique UNIQUE (campaign_id,id),
  ADD COLUMN home_team_id uuid,
  ADD COLUMN away_team_id uuid;

CREATE TABLE fd.match_lineups (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('starter','substitute')),
  position text NOT NULL CHECK (position IN ('goalkeeper','defender','midfielder','forward')),
  shirt_number smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,fixture_id,team_id,player_id),
  FOREIGN KEY (campaign_id,fixture_id) REFERENCES fd.season_fixtures(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id)
);

CREATE TABLE fd.match_events (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL,
  sequence smallint NOT NULL CHECK (sequence >= 0),
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 130),
  event_type text NOT NULL CHECK (event_type IN ('shot','goal','save','miss','substitution','half_time','full_time','yellow_card','red_card','injury')),
  team_id uuid,
  player_id uuid,
  related_player_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,fixture_id,sequence),
  FOREIGN KEY (campaign_id,fixture_id) REFERENCES fd.season_fixtures(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id),
  FOREIGN KEY (campaign_id,related_player_id) REFERENCES fd.players(campaign_id,id)
);

ALTER TABLE fd.players
  ADD COLUMN appearances integer NOT NULL DEFAULT 0 CHECK (appearances >= 0),
  ADD COLUMN career_goals integer NOT NULL DEFAULT 0 CHECK (career_goals >= 0),
  ADD COLUMN career_assists integer NOT NULL DEFAULT 0 CHECK (career_assists >= 0),
  ADD COLUMN career_minutes integer NOT NULL DEFAULT 0 CHECK (career_minutes >= 0),
  ADD COLUMN clean_sheets integer NOT NULL DEFAULT 0 CHECK (clean_sheets >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE fd.player_match_stats (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  started boolean NOT NULL,
  minutes_played smallint NOT NULL CHECK (minutes_played BETWEEN 0 AND 130),
  goals smallint NOT NULL DEFAULT 0 CHECK (goals BETWEEN 0 AND 20),
  assists smallint NOT NULL DEFAULT 0 CHECK (assists BETWEEN 0 AND 20),
  clean_sheet boolean NOT NULL DEFAULT false,
  rating numeric(3,1) NOT NULL CHECK (rating BETWEEN 0 AND 10),
  PRIMARY KEY (campaign_id,fixture_id,player_id),
  FOREIGN KEY (campaign_id,fixture_id) REFERENCES fd.season_fixtures(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id)
);

CREATE INDEX fd_players_team_position_idx ON fd.players(campaign_id,team_id,position,shirt_number);
CREATE INDEX fd_match_events_fixture_idx ON fd.match_events(campaign_id,fixture_id,minute,sequence);

-- Convert legacy string fixtures to stable team identities.
INSERT INTO fd.teams(campaign_id,name,club_id,is_player_controlled)
SELECT DISTINCT c.id, names.team_name, cl.id, cl.id IS NOT NULL
FROM fd.campaigns c
JOIN (
  SELECT campaign_id, home_team AS team_name FROM fd.season_fixtures
  UNION
  SELECT campaign_id, away_team AS team_name FROM fd.season_fixtures
) names ON names.campaign_id=c.id
LEFT JOIN fd.clubs cl ON cl.campaign_id=c.id AND cl.name=names.team_name
ON CONFLICT(campaign_id,name) DO NOTHING;

UPDATE fd.season_fixtures f
SET home_team_id=ht.id, away_team_id=at.id
FROM fd.teams ht, fd.teams at
WHERE ht.campaign_id=f.campaign_id AND ht.name=f.home_team
  AND at.campaign_id=f.campaign_id AND at.name=f.away_team;

ALTER TABLE fd.season_fixtures
  ALTER COLUMN home_team_id SET NOT NULL,
  ALTER COLUMN away_team_id SET NOT NULL,
  ADD CONSTRAINT fd_fixture_home_team_fk FOREIGN KEY (campaign_id,home_team_id) REFERENCES fd.teams(campaign_id,id),
  ADD CONSTRAINT fd_fixture_away_team_fk FOREIGN KEY (campaign_id,away_team_id) REFERENCES fd.teams(campaign_id,id);

CREATE OR REPLACE FUNCTION fd.seed_campaign_squads(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fd, public
AS $$
DECLARE
  owner_id bigint;
  first_names text[] := ARRAY['Alex','Liam','Noah','Ethan','Mason','Lucas','Oliver','Leo','Oscar','Jack','Harry','Theo','Milan','Daniel','Adam','Ryan','Kai','Finn','Elliot','Max'];
  last_names text[] := ARRAY['Carter','Walker','Bennett','Hayes','Morgan','Reed','Foster','Brooks','Parker','Collins','Ward','Price','Morris','Gray','Cooper','Bailey','Turner','Murphy','Cook','Bell'];
BEGIN
  SELECT owner_telegram_id INTO owner_id FROM fd.campaigns WHERE id=p_campaign_id;
  IF owner_id IS NULL OR owner_id <> NULLIF(current_setting('fd.telegram_id',true),'')::bigint THEN
    RAISE EXCEPTION 'campaign access denied';
  END IF;

  INSERT INTO fd.teams(campaign_id,name,club_id,is_player_controlled)
  SELECT c.id, cl.name, cl.id, true FROM fd.campaigns c
  JOIN fd.clubs cl ON cl.campaign_id=c.id
  WHERE c.id=p_campaign_id
  ON CONFLICT(campaign_id,name) DO NOTHING;

  INSERT INTO fd.teams(campaign_id,name,is_player_controlled)
  SELECT p_campaign_id, team_name, false
  FROM (VALUES ('Harbor Athletic'),('Redbridge FC'),('Kingsport United')) AS rivals(team_name)
  ON CONFLICT(campaign_id,name) DO NOTHING;

  INSERT INTO fd.team_tactics(campaign_id,team_id)
  SELECT campaign_id,id FROM fd.teams WHERE campaign_id=p_campaign_id
  ON CONFLICT(campaign_id,team_id) DO NOTHING;

  INSERT INTO fd.players(
    campaign_id,team_id,full_name,position,shirt_number,age,pace,shooting,passing,
    defending,physical,goalkeeping,stamina,morale,fatigue,potential,market_value_minor,wage_minor,contract_until
  )
  SELECT p_campaign_id, t.id,
    first_names[((n + team_rank - 2) % array_length(first_names,1))+1] || ' ' ||
    last_names[((n * 3 + team_rank - 2) % array_length(last_names,1))+1],
    CASE WHEN n IN (1,19) THEN 'goalkeeper' WHEN n BETWEEN 2 AND 7 THEN 'defender'
         WHEN n BETWEEN 8 AND 13 THEN 'midfielder' ELSE 'forward' END,
    n,
    19 + mod(abs(hashtext(t.name || n::text)::bigint),14)::smallint,
    48 + mod(abs(hashtext(t.name || n::text || 'pace')::bigint),43)::smallint,
    45 + mod(abs(hashtext(t.name || n::text || 'shot')::bigint),46)::smallint,
    45 + mod(abs(hashtext(t.name || n::text || 'pass')::bigint),46)::smallint,
    45 + mod(abs(hashtext(t.name || n::text || 'def')::bigint),46)::smallint,
    48 + mod(abs(hashtext(t.name || n::text || 'phys')::bigint),43)::smallint,
    CASE WHEN n IN (1,19) THEN 60 + mod(abs(hashtext(t.name || n::text || 'gk')::bigint),41)::smallint
         ELSE 5 + mod(abs(hashtext(t.name || n::text || 'gk')::bigint),35)::smallint END,
    55 + mod(abs(hashtext(t.name || n::text || 'sta')::bigint),41)::smallint,
    60,0,65 + mod(abs(hashtext(t.name || n::text || 'pot')::bigint),31)::smallint,
    1000000 + mod(abs(hashtext(t.name || n::text || 'mv')::bigint),9000000)::bigint,
    10000 + mod(abs(hashtext(t.name || n::text || 'wage')::bigint),30000)::bigint,
    make_date((SELECT current_year FROM fd.campaigns WHERE id=p_campaign_id)+3,6,30)
  FROM (
    SELECT id,name,row_number() OVER(ORDER BY name)::integer AS team_rank
    FROM fd.teams WHERE campaign_id=p_campaign_id
  ) t CROSS JOIN generate_series(1,19) AS gs(n)
  ON CONFLICT(campaign_id,team_id,shirt_number) DO NOTHING;

  UPDATE fd.season_fixtures f SET home_team_id=ht.id,away_team_id=at.id
  FROM fd.teams ht,fd.teams at
  WHERE f.campaign_id=p_campaign_id AND ht.campaign_id=f.campaign_id AND ht.name=f.home_team
    AND at.campaign_id=f.campaign_id AND at.name=f.away_team;

  INSERT INTO fd.match_lineups(campaign_id,fixture_id,team_id,player_id,role,position,shirt_number)
  SELECT f.campaign_id,f.id,p.team_id,p.id,
    CASE WHEN p.position='goalkeeper' AND p.shirt_number=1
      OR (p.position='defender' AND p.shirt_number BETWEEN 2 AND 5)
      OR (p.position='midfielder' AND p.shirt_number BETWEEN 8 AND 10)
      OR (p.position='forward' AND p.shirt_number BETWEEN 14 AND 16)
      THEN 'starter' ELSE 'substitute' END,
    p.position,p.shirt_number
  FROM fd.season_fixtures f
  JOIN fd.players p ON p.campaign_id=f.campaign_id
    AND p.team_id IN (f.home_team_id,f.away_team_id)
  WHERE f.campaign_id=p_campaign_id
  ON CONFLICT(campaign_id,fixture_id,team_id,player_id) DO NOTHING;
END;
$$;

-- Backfill rosters and fixture identity for existing campaigns.
DO $$
DECLARE campaign_row record;
BEGIN
  FOR campaign_row IN SELECT id,owner_telegram_id FROM fd.campaigns LOOP
    PERFORM set_config('fd.telegram_id',campaign_row.owner_telegram_id::text,true);
    PERFORM fd.seed_campaign_squads(campaign_row.id);
  END LOOP;
END;
$$;

ALTER TABLE fd.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.team_tactics ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.match_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.player_match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY fd_runtime_access ON fd.teams FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.players FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.team_tactics FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.match_lineups FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.match_events FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));

CREATE POLICY fd_runtime_access ON fd.player_match_stats FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));

GRANT SELECT,INSERT,UPDATE ON fd.teams,fd.players,fd.team_tactics,fd.match_lineups,fd.match_events,fd.player_match_stats TO fd_runtime;
GRANT EXECUTE ON FUNCTION fd.seed_campaign_squads(uuid) TO fd_runtime;
