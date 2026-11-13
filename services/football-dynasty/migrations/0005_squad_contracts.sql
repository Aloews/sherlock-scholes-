-- Migration 0005: Campaign-scoped players and contracts
-- Adds squad and contract management to Football Dynasty campaigns

-- Players table: fictional players within a campaign
CREATE TABLE fd.players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    age integer NOT NULL CHECK (age >= 16 AND age <= 40),
    skill_rating integer NOT NULL CHECK (skill_rating >= 1 AND skill_rating <= 99),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, id)
);

CREATE INDEX idx_players_campaign ON fd.players(campaign_id);

-- Contracts table: player-club contract relationships
CREATE TABLE fd.contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    weekly_wage integer NOT NULL CHECK (weekly_wage > 0 AND weekly_wage <= 1000000),
    signing_date date NOT NULL,
    expiry_date date NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'expired', 'released')),
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    FOREIGN KEY (campaign_id, player_id) REFERENCES fd.players(campaign_id, id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (expiry_date > signing_date),
    CHECK (
        (status = 'released' AND released_at IS NOT NULL) OR
        (status != 'released' AND released_at IS NULL)
    )
);

CREATE INDEX idx_contracts_campaign ON fd.contracts(campaign_id);
CREATE INDEX idx_contracts_player ON fd.contracts(campaign_id, player_id);
CREATE INDEX idx_contracts_club ON fd.contracts(campaign_id, club_id);

-- Enforce one active contract per player
CREATE UNIQUE INDEX idx_contracts_one_active_per_player
    ON fd.contracts(campaign_id, player_id)
    WHERE status = 'active';

-- RLS policies for players
ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_campaign_owner_read ON fd.players
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY players_campaign_owner_write ON fd.players
    FOR ALL
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

-- RLS policies for contracts
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_campaign_owner_read ON fd.contracts
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY contracts_campaign_owner_write ON fd.contracts
    FOR ALL
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

-- Grant service role access
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.players TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.contracts TO service_role;

-- Seeded players tracking: prevent duplicate seeding
CREATE TABLE fd.campaign_squad_seeded (
    campaign_id uuid PRIMARY KEY REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    seeded_at timestamptz NOT NULL DEFAULT now(),
    player_count integer NOT NULL CHECK (player_count = 23)
);

CREATE INDEX idx_campaign_squad_seeded_campaign ON fd.campaign_squad_seeded(campaign_id);

ALTER TABLE fd.campaign_squad_seeded ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_squad_seeded_campaign_owner_read ON fd.campaign_squad_seeded
    FOR SELECT
    USING (
        campaign_id IN (
            SELECT id FROM fd.campaigns
            WHERE telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY campaign_squad_seeded_campaign_owner_write ON fd.campaign_squad_seeded
    FOR ALL
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

GRANT SELECT, INSERT, UPDATE, DELETE ON fd.campaign_squad_seeded TO service_role;
