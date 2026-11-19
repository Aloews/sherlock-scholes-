ALTER TABLE fd.campaigns
  ADD COLUMN game_date date NOT NULL DEFAULT DATE '2026-01-01';

UPDATE fd.campaigns
SET game_date = make_date(current_year, 1, 1);

CREATE TABLE fd.game_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  game_date date NOT NULL,
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(choices) = 'array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','expired')),
  resolution jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, event_key)
);

CREATE INDEX fd_game_events_inbox_idx
  ON fd.game_events(campaign_id, status, game_date DESC, priority DESC);

ALTER TABLE fd.game_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_runtime_access ON fd.game_events
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

GRANT SELECT, INSERT, UPDATE ON fd.game_events TO fd_runtime;
