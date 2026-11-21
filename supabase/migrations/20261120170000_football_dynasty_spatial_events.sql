-- Persist deterministic player movement, passing lanes, tackles and event-derived heatmaps.
CREATE TABLE fd.match_spatial_events (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL,
  sequence smallint NOT NULL CHECK (sequence >= 0),
  minute smallint NOT NULL CHECK (minute BETWEEN 1 AND 120),
  event_type text NOT NULL CHECK (event_type IN ('movement','pass','tackle')),
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  related_player_id uuid,
  from_x smallint NOT NULL CHECK (from_x BETWEEN 0 AND 10000),
  from_y smallint NOT NULL CHECK (from_y BETWEEN 0 AND 10000),
  to_x smallint NOT NULL CHECK (to_x BETWEEN 0 AND 10000),
  to_y smallint NOT NULL CHECK (to_y BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,fixture_id,sequence),
  FOREIGN KEY (campaign_id,fixture_id) REFERENCES fd.season_fixtures(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id),
  FOREIGN KEY (campaign_id,related_player_id) REFERENCES fd.players(campaign_id,id)
);
CREATE TABLE fd.match_player_heatmaps (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fixture_id uuid NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  bins jsonb NOT NULL CHECK (jsonb_typeof(bins)='array'),
  samples integer NOT NULL CHECK (samples >= 0),
  PRIMARY KEY (campaign_id,fixture_id,player_id),
  FOREIGN KEY (campaign_id,fixture_id) REFERENCES fd.season_fixtures(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id,team_id) REFERENCES fd.teams(campaign_id,id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id)
);
CREATE INDEX fd_match_spatial_events_fixture_idx ON fd.match_spatial_events(campaign_id,fixture_id,minute,sequence);
ALTER TABLE fd.match_spatial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.match_player_heatmaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.match_spatial_events FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.match_player_heatmaps FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
GRANT SELECT,INSERT,UPDATE ON fd.match_spatial_events,fd.match_player_heatmaps TO fd_runtime;
