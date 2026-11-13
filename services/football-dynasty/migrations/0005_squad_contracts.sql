-- Campaign-scoped fictional players and their contracts.
-- Campaign ownership is inherited from fd.campaigns.owner_telegram_id.

CREATE TABLE fd.players (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    club_id uuid NOT NULL,
    seed_index integer NOT NULL CHECK (seed_index BETWEEN 0 AND 22),
    name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
    position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    age integer NOT NULL CHECK (age BETWEEN 16 AND 40),
    ability integer NOT NULL CHECK (ability BETWEEN 1 AND 99),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, id),
    UNIQUE (campaign_id, seed_index),
    FOREIGN KEY (campaign_id, club_id)
        REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE
);

CREATE INDEX fd_players_campaign_club_idx
    ON fd.players (campaign_id, club_id, seed_index);

CREATE TABLE fd.contracts (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    wage_per_week bigint NOT NULL
        CHECK (wage_per_week BETWEEN 1 AND 1000000000),
    start_year integer NOT NULL,
    end_year integer NOT NULL,
    status text NOT NULL
        CHECK (status IN ('active', 'expired', 'released')),
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    FOREIGN KEY (campaign_id, player_id)
        REFERENCES fd.players(campaign_id, id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id, club_id)
        REFERENCES fd.clubs(campaign_id, id) ON DELETE CASCADE,
    CHECK (end_year > start_year AND end_year - start_year BETWEEN 1 AND 5),
    CHECK (
        (status = 'released' AND released_at IS NOT NULL)
        OR (status <> 'released' AND released_at IS NULL)
    )
);

CREATE INDEX fd_contracts_campaign_player_idx
    ON fd.contracts (campaign_id, player_id);

CREATE INDEX fd_contracts_campaign_club_idx
    ON fd.contracts (campaign_id, club_id);

CREATE UNIQUE INDEX fd_contracts_one_active_per_player_idx
    ON fd.contracts (campaign_id, player_id)
    WHERE status = 'active';

ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY fd_runtime_access ON fd.players
    FOR ALL TO fd_runtime
    USING (
        EXISTS (
            SELECT 1
            FROM fd.campaigns c
            WHERE c.id = campaign_id
              AND c.owner_telegram_id =
                  NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM fd.campaigns c
            WHERE c.id = campaign_id
              AND c.owner_telegram_id =
                  NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint
        )
    );

CREATE POLICY fd_runtime_access ON fd.contracts
    FOR ALL TO fd_runtime
    USING (
        EXISTS (
            SELECT 1
            FROM fd.campaigns c
            WHERE c.id = campaign_id
              AND c.owner_telegram_id =
                  NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM fd.campaigns c
            WHERE c.id = campaign_id
              AND c.owner_telegram_id =
                  NULLIF((SELECT current_setting('fd.telegram_id', true)), '')::bigint
        )
    );

GRANT USAGE ON SCHEMA fd TO fd_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON fd.players, fd.contracts TO fd_runtime;
