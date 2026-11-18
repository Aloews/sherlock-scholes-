-- Persistent campaign-owned progress for the 18 strategic-judgment lessons.
CREATE TABLE fd.doctrine_progress (
    campaign_id uuid NOT NULL REFERENCES fd.campaigns(id) ON DELETE CASCADE,
    principle_id smallint NOT NULL CHECK (principle_id BETWEEN 1 AND 18),
    choice_id text NOT NULL CHECK (choice_id IN ('a','b','c')),
    score smallint NOT NULL CHECK (score BETWEEN 0 AND 2),
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, principle_id)
);

ALTER TABLE fd.doctrine_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd.doctrine_progress FORCE ROW LEVEL SECURITY;

CREATE POLICY fd_runtime_access ON fd.doctrine_progress
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

REVOKE ALL ON fd.doctrine_progress FROM fd_runtime;
GRANT SELECT, INSERT ON fd.doctrine_progress TO fd_runtime;
