-- Migration: 0005_squad_contracts
-- Purpose: Add campaign-scoped players and contracts with deterministic seeding and RLS

-- Create players table
CREATE TABLE fd.players (
    campaign_id UUID NOT NULL,
    id UUID NOT NULL,
    full_name TEXT NOT NULL,
    position TEXT NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    age INT NOT NULL CHECK (age BETWEEN 16 AND 45),
    skill INT NOT NULL CHECK (skill BETWEEN 1 AND 100),
    seed_index INT NOT NULL CHECK (seed_index >= 0),
    PRIMARY KEY (campaign_id, id),
    UNIQUE (campaign_id, seed_index),
    FOREIGN KEY (campaign_id) REFERENCES fd.campaigns(id) ON DELETE CASCADE
);

-- Create contracts table
CREATE TABLE fd.contracts (
    campaign_id UUID NOT NULL,
    id UUID NOT NULL,
    player_id UUID NOT NULL,
    club_id UUID NOT NULL,
    start_year INT NOT NULL CHECK (start_year >= 1),
    end_year INT NOT NULL CHECK (end_year >= start_year),
    wage_per_year BIGINT NOT NULL CHECK (wage_per_year BETWEEN 1 AND 100000000),
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'released')),
    released_at TIMESTAMPTZ,
    PRIMARY KEY (campaign_id, id),
    FOREIGN KEY (campaign_id) REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, player_id) REFERENCES fd.players(campaign_id, id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (
        (status = 'released' AND released_at IS NOT NULL) OR
        (status != 'released' AND released_at IS NULL)
    ),
    CHECK (end_year - start_year + 1 BETWEEN 1 AND 5)
);

-- Partial unique index: at most one active contract per player
CREATE UNIQUE INDEX idx_contracts_active_player
    ON fd.contracts(campaign_id, player_id)
    WHERE status = 'active';

-- Indexes for common queries
CREATE INDEX idx_players_campaign ON fd.players(campaign_id);
CREATE INDEX idx_contracts_campaign ON fd.contracts(campaign_id);
CREATE INDEX idx_contracts_player ON fd.contracts(campaign_id, player_id);
CREATE INDEX idx_contracts_club ON fd.contracts(campaign_id, club_id);
CREATE INDEX idx_contracts_status ON fd.contracts(campaign_id, status);

-- RLS policies for players
ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_owner_access ON fd.players
    FOR ALL
    TO fd_runtime
    USING (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = players.campaign_id
            AND c.telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = players.campaign_id
            AND c.telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

-- RLS policies for contracts
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_owner_access ON fd.contracts
    FOR ALL
    TO fd_runtime
    USING (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = contracts.campaign_id
            AND c.telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = contracts.campaign_id
            AND c.telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

-- Grant access to fd_runtime role
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.players TO fd_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.contracts TO fd_runtime;
