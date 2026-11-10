-- Replace permissive runtime policies with campaign-owner isolation.
-- Every API transaction must set fd.telegram_id using SET LOCAL before touching fd tables.

DROP POLICY IF EXISTS fd_runtime_access ON fd.campaigns;
CREATE POLICY fd_runtime_access ON fd.campaigns
  FOR ALL TO fd_runtime
  USING (owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint)
  WITH CHECK (owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint);

DROP POLICY IF EXISTS fd_runtime_access ON fd.dynasties;
CREATE POLICY fd_runtime_access ON fd.dynasties
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.characters;
CREATE POLICY fd_runtime_access ON fd.characters
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.family_relations;
CREATE POLICY fd_runtime_access ON fd.family_relations
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.clubs;
CREATE POLICY fd_runtime_access ON fd.clubs
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.club_ownership;
CREATE POLICY fd_runtime_access ON fd.club_ownership
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.accounts;
CREATE POLICY fd_runtime_access ON fd.accounts
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.journal_entries;
CREATE POLICY fd_runtime_access ON fd.journal_entries
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.journal_lines;
CREATE POLICY fd_runtime_access ON fd.journal_lines
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.chronicle;
CREATE POLICY fd_runtime_access ON fd.chronicle
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));

DROP POLICY IF EXISTS fd_runtime_access ON fd.command_receipts;
CREATE POLICY fd_runtime_access ON fd.command_receipts
  FOR ALL TO fd_runtime
  USING (owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint)
  WITH CHECK (owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint);

DROP POLICY IF EXISTS fd_runtime_access ON fd.succession_events;
CREATE POLICY fd_runtime_access ON fd.succession_events
  FOR ALL TO fd_runtime
  USING (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint))
  WITH CHECK (EXISTS (SELECT 1 FROM fd.campaigns c WHERE c.id = campaign_id AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint));
