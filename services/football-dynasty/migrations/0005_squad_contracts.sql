-- Migration: 0005_squad_contracts
-- Create tables for club squads and player contracts with owner-scoped RLS

-- Players table: deterministic fictional players scoped to campaigns
CREATE TABLE IF NOT EXISTS fd.players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    position TEXT NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    date_of_birth DATE NOT NULL,
    nationality TEXT NOT NULL,
    overall_rating SMALLINT NOT NULL CHECK (overall_rating BETWEEN 40 AND 99),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, id)
);

CREATE INDEX idx_players_campaign ON fd.players(campaign_id);
CREATE INDEX idx_players_position ON fd.players(campaign_id, position);

-- Contracts table: player-club employment relationships
CREATE TABLE IF NOT EXISTS fd.contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    player_id UUID NOT NULL,
    club_id UUID NOT NULL,
    weekly_wage INTEGER NOT NULL CHECK (weekly_wage > 0 AND weekly_wage <= 1000000),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    FOREIGN KEY (campaign_id, player_id) REFERENCES fd.players(campaign_id, id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (end_date > start_date),
    CHECK (end_date <= start_date + INTERVAL '10 years'),
    CHECK ((status = 'released' AND released_at IS NOT NULL) OR (status != 'released' AND released_at IS NULL))
);

CREATE INDEX idx_contracts_campaign ON fd.contracts(campaign_id);
CREATE INDEX idx_contracts_player ON fd.contracts(campaign_id, player_id);
CREATE INDEX idx_contracts_club ON fd.contracts(campaign_id, club_id);
CREATE INDEX idx_contracts_status ON fd.contracts(campaign_id, status);

-- Enforce one active contract per player
CREATE UNIQUE INDEX idx_contracts_one_active_per_player
    ON fd.contracts(campaign_id, player_id)
    WHERE status = 'active';

-- Owner-scoped RLS for players
ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_owner_select ON fd.players
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY players_owner_insert ON fd.players
    FOR INSERT
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY players_owner_update ON fd.players
    FOR UPDATE
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY players_owner_delete ON fd.players
    FOR DELETE
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

-- Owner-scoped RLS for contracts
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_owner_select ON fd.contracts
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY contracts_owner_insert ON fd.contracts
    FOR INSERT
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY contracts_owner_update ON fd.contracts
    FOR UPDATE
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );
