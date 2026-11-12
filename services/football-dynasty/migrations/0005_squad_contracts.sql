CREATE TABLE fd.players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    name text NOT NULL,
    position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    seed_index smallint NOT NULL CHECK (seed_index BETWEEN 0 AND 22),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, seed_index),
    UNIQUE (id, campaign_id)
);

CREATE TABLE fd.contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    wage bigint NOT NULL CHECK (wage > 0 AND wage <= 1000000000),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on),
    FOREIGN KEY (player_id, campaign_id)
        REFERENCES fd.players(id, campaign_id) ON DELETE CASCADE,
    FOREIGN KEY (club_id, campaign_id)
        REFERENCES fd.clubs(id, campaign_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX contracts_one_active_per_player
    ON fd.contracts (campaign_id, player_id)
    WHERE ends_on >= CURRENT_DATE;

CREATE INDEX players_campaign_position
    ON fd.players (campaign_id, position, seed_index);

CREATE INDEX contracts_campaign_club
    ON fd.contracts (campaign_id, club_id);

ALTER TABLE fd.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY players_owner_access ON fd.players
    USING (campaign_id IN (
        SELECT id FROM fd.campaigns
        WHERE owner_telegram_id = current_setting('fd.telegram_id')::bigint
    ));

CREATE POLICY contracts_owner_access ON fd.contracts
    USING (campaign_id IN (
        SELECT id FROM fd.campaigns
        WHERE owner_telegram_id = current_setting('fd.telegram_id')::bigint
    ));

GRANT SELECT, INSERT ON fd.players TO fd_runtime;
GRANT SELECT, INSERT, UPDATE ON fd.contracts TO fd_runtime;
