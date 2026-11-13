-- Migration: 0005_squad_contracts
-- Add campaign-scoped players and contracts with RLS, composite keys, and one-active-contract enforcement

CREATE TABLE fd.players (
    campaign_id uuid NOT NULL,
    id uuid NOT NULL,
    full_name text NOT NULL,
    position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, id),
    UNIQUE (campaign_id, id),
    FOREIGN KEY (campaign_id) REFERENCES fd.campaigns(id) ON DELETE CASCADE
);

CREATE TYPE fd.contract_status AS ENUM ('active', 'expired', 'released');

CREATE TABLE fd.contracts (
    campaign_id uuid NOT NULL,
    id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    start_year int NOT NULL,
    end_year int NOT NULL,
    wage_per_year bigint NOT NULL CHECK (wage_per_year > 0 AND wage_per_year <= 100000000),
    status fd.contract_status NOT NULL DEFAULT 'active',
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, id),
    FOREIGN KEY (campaign_id, player_id) REFERENCES fd.players(campaign_id, id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, club_id) REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (start_year <= end_year),
    CHECK (status = 'released' OR released_at IS NULL),
    CHECK (status != 'released' OR released_at IS NOT NULL)
);

CREATE UNIQUE INDEX contracts_one_active_per_player
    ON fd.contracts (campaign_id, player_id)
    WHERE status = 'active';

CREATE INDEX idx_players_campaign ON fd.players(campaign_id);
CREATE INDEX idx_contracts_campaign ON fd.contracts(campaign_id);
CREATE INDEX idx_contracts_player ON fd.contracts(campaign_id, player_id);
CREATE INDEX idx_contracts_club ON fd.contracts(campaign_id, club_id);

COMMENT ON TABLE fd.players IS 'Campaign-scoped fictional players seeded deterministically on first squad read';
COMMENT ON TABLE fd.contracts IS 'Player contracts with status column and partial unique index for one active contract per player';
COMMENT ON COLUMN fd.contracts.wage_per_year IS 'Annual wage in currency units, positive and bounded';
COMMENT ON COLUMN fd.contracts.status IS 'Contract lifecycle state: active, expired, or released';
COMMENT ON COLUMN fd.contracts.released_at IS 'Timestamp when contract was released by owner action';
COMMENT ON INDEX contracts_one_active_per_player IS 'Enforces at most one active contract per player using partial index predicate';

-- RLS policies using initplan style from 0004
ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_owner_access ON fd.players
    FOR ALL TO fd_runtime
    USING (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = players.campaign_id
              AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = players.campaign_id
              AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

CREATE POLICY contracts_owner_access ON fd.contracts
    FOR ALL TO fd_runtime
    USING (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = contracts.campaign_id
              AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fd.campaigns c
            WHERE c.id = contracts.campaign_id
              AND c.owner_telegram_id = NULLIF(current_setting('fd.telegram_id', true), '')::bigint
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON fd.players TO fd_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.contracts TO fd_runtime;

-- Migration verification queries (informational only, not executed by SQLx)
-- SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'fd' AND table_name = 'players');
-- SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'fd' AND table_name = 'contracts');
-- SELECT constraint_type, constraint_name
--   FROM information_schema.table_constraints
--   WHERE table_schema = 'fd' AND table_name = 'players';
-- SELECT constraint_type, constraint_name
--   FROM information_schema.table_constraints
--   WHERE table_schema = 'fd' AND table_name = 'contracts';
-- SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'fd' AND tablename = 'contracts' AND indexname = 'contracts_one_active_per_player';
-- SELECT polname, polcmd, polroles::regrole[]
--   FROM pg_policy
--   WHERE polrelid IN ('fd.players'::regclass, 'fd.contracts'::regclass);
