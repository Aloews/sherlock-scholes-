-- Persist per-player training instructions and an auditable daily development trail.
CREATE TABLE fd.player_training_plans (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  focus text NOT NULL CHECK (focus IN ('finishing','passing','defending','physical','goalkeeping','balanced','recovery')),
  intensity smallint NOT NULL CHECK (intensity BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,player_id),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id),
  CHECK ((focus='recovery' AND intensity=0) OR (focus<>'recovery' AND intensity BETWEEN 20 AND 100))
);

CREATE TABLE fd.player_training_log (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  game_date date NOT NULL,
  focus text NOT NULL CHECK (focus IN ('finishing','passing','defending','physical','goalkeeping','balanced','recovery')),
  intensity smallint NOT NULL CHECK (intensity BETWEEN 0 AND 100),
  attribute_gain smallint NOT NULL DEFAULT 0 CHECK (attribute_gain BETWEEN 0 AND 3),
  improved_attribute text,
  fatigue_delta smallint NOT NULL DEFAULT 0,
  morale_delta smallint NOT NULL DEFAULT 0,
  attributes_before jsonb NOT NULL CHECK (jsonb_typeof(attributes_before)='object'),
  attributes_after jsonb NOT NULL CHECK (jsonb_typeof(attributes_after)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,player_id,game_date),
  FOREIGN KEY (campaign_id,player_id) REFERENCES fd.players(campaign_id,id)
);

CREATE INDEX fd_player_training_plans_campaign_focus_idx ON fd.player_training_plans(campaign_id,focus);
CREATE INDEX fd_player_training_log_campaign_date_idx ON fd.player_training_log(campaign_id,game_date DESC);

ALTER TABLE fd.player_training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.player_training_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.player_training_plans FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.player_training_log FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
GRANT SELECT,INSERT,UPDATE,DELETE ON fd.player_training_plans TO fd_runtime;
GRANT SELECT,INSERT ON fd.player_training_log TO fd_runtime;
