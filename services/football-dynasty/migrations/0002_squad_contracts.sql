-- Persistent campaign squads and contract ledger.

CREATE TABLE fd.players (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    club_id uuid NOT NULL,
    squad_slot smallint NOT NULL CHECK (squad_slot BETWEEN 1 AND 23),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
    generation_seed bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, squad_slot),
    UNIQUE (campaign_id, id),
    UNIQUE (campaign_id, name)
);

CREATE INDEX players_campaign_club_idx
    ON fd.players (campaign_id, club_id);

CREATE INDEX players_campaign_position_idx
    ON fd.players (campaign_id, position);

CREATE TABLE fd.player_contracts (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL,
    player_id uuid NOT NULL,
    club_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'released')),
    wage bigint NOT NULL CHECK (wage >= 0),
    term_months smallint NOT NULL CHECK (term_months BETWEEN 1 AND 60),
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on > starts_on),
    FOREIGN KEY (campaign_id, player_id)
        REFERENCES fd.players (campaign_id, id) ON DELETE CASCADE
);

CREATE INDEX player_contracts_campaign_club_idx
    ON fd.player_contracts (campaign_id, club_id);

CREATE INDEX player_contracts_player_dates_idx
    ON fd.player_contracts (player_id, starts_on, ends_on);

CREATE UNIQUE INDEX player_contracts_one_active_idx
    ON fd.player_contracts (campaign_id, player_id)
    WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON fd.players TO fd_runtime;
GRANT SELECT, INSERT, UPDATE ON fd.player_contracts TO fd_runtime;
