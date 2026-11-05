DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fd_runtime') THEN
        CREATE ROLE fd_runtime NOLOGIN;
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS fd;
REVOKE ALL ON SCHEMA fd FROM PUBLIC;
GRANT USAGE ON SCHEMA fd TO fd_runtime;
GRANT USAGE ON SCHEMA public TO fd_runtime;
GRANT fd_runtime TO postgres;

DO $
BEGIN
    IF to_regprocedure('public.tg_validate_init_data(text)') IS NOT NULL THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.tg_validate_init_data(text) TO fd_runtime';
    END IF;
END
$;
CREATE TABLE fd.campaigns (
    id uuid PRIMARY KEY,
    owner_telegram_id bigint NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    mode text NOT NULL CHECK (mode IN ('sandbox','scenario')),
    seed bigint NOT NULL,
    current_year integer NOT NULL DEFAULT 2026,
    status text NOT NULL CHECK (status IN ('active','succession_pending','ended_no_heir','archived')),
    dynasty_id uuid NOT NULL,
    founder_character_id uuid NOT NULL,
    player_character_id uuid NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fd.dynasties (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    head_character_id uuid NOT NULL,
    prestige integer NOT NULL DEFAULT 0 CHECK (prestige >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,id)
);

CREATE TABLE fd.characters (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 80),
    age integer NOT NULL CHECK (age BETWEEN 0 AND 120),
    life_status text NOT NULL CHECK (life_status IN ('alive','deceased')),
    is_heir boolean NOT NULL DEFAULT false,
    origin text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,id)
);

ALTER TABLE fd.campaigns
    ADD CONSTRAINT fd_campaign_dynasty_fk FOREIGN KEY (dynasty_id) REFERENCES fd.dynasties(id) DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT fd_campaign_founder_fk FOREIGN KEY (founder_character_id) REFERENCES fd.characters(id) DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT fd_campaign_player_fk FOREIGN KEY (player_character_id) REFERENCES fd.characters(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE fd.dynasties
    ADD CONSTRAINT fd_dynasty_head_fk FOREIGN KEY (campaign_id,head_character_id) REFERENCES fd.characters(campaign_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE fd.family_relations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    parent_character_id uuid NOT NULL,
    child_character_id uuid NOT NULL,
    relation_type text NOT NULL CHECK (relation_type IN ('parent_child','adoptive_parent_child')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (campaign_id,parent_character_id) REFERENCES fd.characters(campaign_id,id),
    FOREIGN KEY (campaign_id,child_character_id) REFERENCES fd.characters(campaign_id,id),
    CHECK (parent_character_id <> child_character_id),
    UNIQUE (campaign_id,parent_character_id,child_character_id,relation_type)
);

CREATE TABLE fd.clubs (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    city text NOT NULL,
    reputation integer NOT NULL DEFAULT 0 CHECK (reputation BETWEEN 0 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,id)
);

CREATE TABLE fd.club_ownership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    club_id uuid NOT NULL,
    owner_type text NOT NULL CHECK (owner_type IN ('character','dynasty','holding')),
    owner_id uuid NOT NULL,
    equity_bps integer NOT NULL CHECK (equity_bps BETWEEN 0 AND 10000),
    voting_bps integer NOT NULL CHECK (voting_bps BETWEEN 0 AND 10000),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (campaign_id,club_id) REFERENCES fd.clubs(campaign_id,id),
    UNIQUE (campaign_id,club_id,owner_type,owner_id)
);

CREATE TABLE fd.accounts (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    name text NOT NULL,
    account_type text NOT NULL CHECK (account_type IN ('cash','equity','debt','revenue','expense')),
    owner_type text NOT NULL CHECK (owner_type IN ('character','dynasty','club','holding','system')),
    owner_id uuid NOT NULL,
    currency char(3) NOT NULL,
    normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,id)
);

CREATE TABLE fd.journal_entries (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    memo text NOT NULL,
    game_year integer NOT NULL,
    posted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,id),
    UNIQUE (campaign_id,idempotency_key)
);

CREATE TABLE fd.journal_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    journal_entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    side text NOT NULL CHECK (side IN ('debit','credit')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (campaign_id,journal_entry_id) REFERENCES fd.journal_entries(campaign_id,id),
    FOREIGN KEY (campaign_id,account_id) REFERENCES fd.accounts(campaign_id,id)
);

CREATE OR REPLACE FUNCTION fd.assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    entry_id uuid;
    debit_total bigint;
    credit_total bigint;
BEGIN
    entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE side='debit'),0),
        COALESCE(SUM(amount_minor) FILTER (WHERE side='credit'),0)
    INTO debit_total, credit_total
    FROM fd.journal_lines
    WHERE journal_entry_id = entry_id;
    IF debit_total <> credit_total THEN
        RAISE EXCEPTION 'unbalanced journal entry %: debit %, credit %', entry_id, debit_total, credit_total;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER fd_journal_balanced
AFTER INSERT ON fd.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fd.assert_journal_balanced();

CREATE TABLE fd.chronicle (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    title text NOT NULL,
    game_year integer NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fd.command_receipts (
    owner_telegram_id bigint NOT NULL,
    idempotency_key text NOT NULL,
    command_type text NOT NULL,
    request_hash text NOT NULL,
    campaign_id uuid REFERENCES fd.campaigns(id) ON DELETE SET NULL,
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_telegram_id,idempotency_key)
);

CREATE TABLE fd.succession_events (
    id uuid PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    deceased_character_id uuid NOT NULL,
    heir_character_id uuid NOT NULL,
    game_year integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id,deceased_character_id),
    FOREIGN KEY (campaign_id,deceased_character_id) REFERENCES fd.characters(campaign_id,id),
    FOREIGN KEY (campaign_id,heir_character_id) REFERENCES fd.characters(campaign_id,id)
);

CREATE INDEX fd_campaign_owner_idx ON fd.campaigns(owner_telegram_id,created_at DESC);
CREATE INDEX fd_characters_campaign_age_idx ON fd.characters(campaign_id,life_status,age);
CREATE INDEX fd_relations_parent_idx ON fd.family_relations(campaign_id,parent_character_id,relation_type);
CREATE INDEX fd_club_ownership_club_idx ON fd.club_ownership(campaign_id,club_id);
CREATE INDEX fd_chronicle_campaign_year_idx ON fd.chronicle(campaign_id,game_year DESC,created_at DESC);
CREATE INDEX fd_journal_lines_account_idx ON fd.journal_lines(campaign_id,account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fd TO fd_runtime;
REVOKE UPDATE, DELETE ON fd.journal_entries, fd.journal_lines, fd.chronicle, fd.succession_events FROM fd_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA fd GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fd_runtime;
