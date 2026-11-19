ALTER TABLE fd.game_events
  ADD COLUMN expires_on date;

UPDATE fd.game_events
SET expires_on = game_date + 7
WHERE expires_on IS NULL;

ALTER TABLE fd.game_events
  ALTER COLUMN expires_on SET NOT NULL,
  ADD CONSTRAINT fd_game_events_deadline_check CHECK (expires_on >= game_date);

CREATE INDEX fd_game_events_expiry_idx
  ON fd.game_events(campaign_id, expires_on)
  WHERE status = 'pending';
