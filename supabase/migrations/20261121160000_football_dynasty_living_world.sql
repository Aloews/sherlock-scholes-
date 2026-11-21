-- LW0: persistent event facts and bounded reaction queue.
CREATE TABLE fd.world_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 120),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  game_day integer NOT NULL CHECK (game_day >= 0),
  location_key text NOT NULL CHECK (length(location_key) BETWEEN 1 AND 120),
  state text NOT NULL CHECK (state IN ('generated','known','active','resolved','expired')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  parent_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (campaign_id,event_key),
  UNIQUE (campaign_id,id),
  FOREIGN KEY (campaign_id,parent_event_id) REFERENCES fd.world_events(campaign_id,id)
);
CREATE TABLE fd.world_facts (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  fact_key text NOT NULL CHECK (length(fact_key) BETWEEN 1 AND 120),
  fact_value jsonb NOT NULL,
  source_event_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,fact_key,source_event_id),
  FOREIGN KEY (campaign_id,source_event_id) REFERENCES fd.world_events(campaign_id,id)
);
CREATE TABLE fd.world_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL,
  reaction_key text NOT NULL CHECK (length(reaction_key) BETWEEN 1 AND 120),
  reaction_type text NOT NULL CHECK (length(reaction_type) BETWEEN 1 AND 64),
  due_game_day integer NOT NULL CHECK (due_game_day >= 0),
  state text NOT NULL CHECK (state IN ('queued','processed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (campaign_id,reaction_key),
  FOREIGN KEY (campaign_id,source_event_id) REFERENCES fd.world_events(campaign_id,id)
);
CREATE INDEX fd_world_events_campaign_state_idx ON fd.world_events(campaign_id,state,game_day);
CREATE INDEX fd_world_reactions_due_idx ON fd.world_reactions(campaign_id,state,due_game_day);
ALTER TABLE fd.world_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.world_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.world_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.world_events FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.world_facts FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
CREATE POLICY fd_runtime_access ON fd.world_reactions FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
GRANT SELECT,INSERT,UPDATE ON fd.world_events,fd.world_facts,fd.world_reactions TO fd_runtime;

CREATE TABLE fd.world_actor_knowledge (
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  actor_key text NOT NULL CHECK (length(actor_key) BETWEEN 1 AND 120),
  source_event_id uuid NOT NULL,
  learned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,actor_key,source_event_id),
  FOREIGN KEY (campaign_id,source_event_id) REFERENCES fd.world_events(campaign_id,id)
);
CREATE INDEX fd_world_actor_knowledge_event_idx ON fd.world_actor_knowledge(campaign_id,source_event_id);
ALTER TABLE fd.world_actor_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.world_actor_knowledge FOR ALL TO fd_runtime
USING (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint))
WITH CHECK (EXISTS(SELECT 1 FROM fd.campaigns c WHERE c.id=campaign_id AND c.owner_telegram_id=NULLIF(current_setting('fd.telegram_id',true),'')::bigint));
GRANT SELECT,INSERT,UPDATE ON fd.world_actor_knowledge TO fd_runtime;
