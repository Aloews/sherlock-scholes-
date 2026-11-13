-- Football Dynasty: squad and contract tables
-- Version: 0005
-- Depends on: 0004_campaign_succession.sql

CREATE TABLE fd.players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    club_id UUID NOT NULL,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    position TEXT NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    age INTEGER NOT NULL CHECK (age BETWEEN 16 AND 45),
    ability INTEGER NOT NULL CHECK (ability BETWEEN 1 AND 100),
    seed_index INTEGER NOT NULL CHECK (seed_index >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    UNIQUE (campaign_id, seed_index)
);

CREATE INDEX idx_players_campaign ON fd.players(campaign_id);
CREATE INDEX idx_players_club ON fd.players(campaign_id, club_id);

ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_owner_read ON fd.players
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY players_owner_write ON fd.players
    FOR ALL
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

GRANT SELECT, INSERT, UPDATE ON fd.players TO fd_runtime;

CREATE TABLE fd.contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES fd.players(id) ON DELETE CASCADE,
    club_id UUID NOT NULL,
    wage_per_week INTEGER NOT NULL CHECK (wage_per_week > 0 AND wage_per_week <= 1000000),
    start_year INTEGER NOT NULL CHECK (start_year > 0),
    end_year INTEGER NOT NULL CHECK (end_year >= start_year),
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'released')),
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (
        (status = 'released' AND released_at IS NOT NULL) OR
        (status != 'released' AND released_at IS NULL)
    )
);

CREATE INDEX idx_contracts_campaign ON fd.contracts(campaign_id);
CREATE INDEX idx_contracts_player ON fd.contracts(player_id);
CREATE INDEX idx_contracts_club ON fd.contracts(campaign_id, club_id);
CREATE INDEX idx_contracts_status ON fd.contracts(status);

CREATE UNIQUE INDEX idx_contracts_active_player ON fd.contracts(player_id)
    WHERE status = 'active';

ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_owner_read ON fd.contracts
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY contracts_owner_write ON fd.contracts
    FOR ALL
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

GRANT SELECT, INSERT, UPDATE ON fd.contracts TO fd_runtime;

COMMENT ON TABLE fd.players IS 'Fictional players in Football Dynasty campaigns';
COMMENT ON TABLE fd.contracts IS 'Player contracts with status tracking for active/expired/released';
COMMENT ON CONSTRAINT contracts_check ON fd.contracts IS 'Enforce released_at presence only when status is released';
