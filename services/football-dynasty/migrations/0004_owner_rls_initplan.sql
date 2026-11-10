-- Harden the trigger function search path.
ALTER FUNCTION fd.assert_journal_balanced() SET search_path = pg_catalog, pg_temp;

-- Keep the verified Telegram owner value as an initplan instead of
-- re-evaluating current_setting() for every row, and index uncovered FKs.

DROP POLICY IF EXISTS fd_runtime_access ON fd.campaigns;
CREATE POLICY fd_runtime_access ON fd.campaigns
  FOR ALL TO fd_runtime
  USING (owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint)
  WITH CHECK (owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint);

DROP POLICY IF EXISTS fd_runtime_access ON fd.dynasties;
CREATE POLICY fd_runtime_access ON fd.dynasties
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.characters;
CREATE POLICY fd_runtime_access ON fd.characters
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.family_relations;
CREATE POLICY fd_runtime_access ON fd.family_relations
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.clubs;
CREATE POLICY fd_runtime_access ON fd.clubs
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.club_ownership;
CREATE POLICY fd_runtime_access ON fd.club_ownership
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.accounts;
CREATE POLICY fd_runtime_access ON fd.accounts
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.journal_entries;
CREATE POLICY fd_runtime_access ON fd.journal_entries
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.journal_lines;
CREATE POLICY fd_runtime_access ON fd.journal_lines
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.chronicle;
CREATE POLICY fd_runtime_access ON fd.chronicle
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.command_receipts;
CREATE POLICY fd_runtime_access ON fd.command_receipts
  FOR ALL TO fd_runtime
  USING (owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint)
  WITH CHECK (owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint);

DROP POLICY IF EXISTS fd_runtime_access ON fd.succession_events;
CREATE POLICY fd_runtime_access ON fd.succession_events
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint));

CREATE INDEX IF NOT EXISTS fd_campaign_dynasty_fk_idx ON fd.campaigns (dynasty_id);
CREATE INDEX IF NOT EXISTS fd_campaign_founder_fk_idx ON fd.campaigns (founder_character_id);
CREATE INDEX IF NOT EXISTS fd_campaign_player_fk_idx ON fd.campaigns (player_character_id);
CREATE INDEX IF NOT EXISTS fd_command_receipts_campaign_fk_idx ON fd.command_receipts (campaign_id);
CREATE INDEX IF NOT EXISTS fd_dynasty_head_fk_idx ON fd.dynasties (campaign_id, head_character_id);
CREATE INDEX IF NOT EXISTS fd_family_relations_child_fk_idx ON fd.family_relations (campaign_id, child_character_id);
CREATE INDEX IF NOT EXISTS fd_journal_lines_entry_fk_idx ON fd.journal_lines (campaign_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS fd_succession_events_heir_fk_idx ON fd.succession_events (campaign_id, heir_character_id);
