-- Run against the disposable PostgreSQL service after the three FD migrations.
DO $$
DECLARE
  v_tables integer;
  v_unprotected integer;
  v_unscoped integer;
  v_bypass boolean;
BEGIN
  SELECT count(*) INTO v_tables FROM pg_tables WHERE schemaname = 'fd';
  IF v_tables <> 12 THEN
    RAISE EXCEPTION 'expected 12 Football Dynasty tables, found %', v_tables;
  END IF;

  SELECT count(*) INTO v_unprotected
    FROM pg_tables WHERE schemaname = 'fd' AND NOT rowsecurity;
  IF v_unprotected <> 0 THEN
    RAISE EXCEPTION '% Football Dynasty tables have RLS disabled', v_unprotected;
  END IF;

  SELECT count(*) INTO v_unscoped
    FROM pg_policies
   WHERE schemaname = 'fd'
     AND (qual NOT LIKE '%fd.telegram_id%' OR with_check NOT LIKE '%fd.telegram_id%');
  IF v_unscoped <> 0 THEN
    RAISE EXCEPTION '% Football Dynasty policies are not owner-scoped', v_unscoped;
  END IF;

  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'fd_runtime';
  IF v_bypass IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'fd_runtime must not bypass row-level security';
  END IF;
END
$$;

BEGIN;
SET LOCAL ROLE fd_runtime;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL fd.telegram_id = '1001';

INSERT INTO fd.campaigns
  (id, owner_telegram_id, name, mode, seed, current_year, status, dynasty_id, founder_character_id, player_character_id)
VALUES
  ('00000000-0000-0000-0000-000000000101', 1001, 'RLS owner test', 'sandbox', 42, 2026, 'active',
   '00000000-0000-0000-0000-000000000103',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000102');

INSERT INTO fd.characters
  (id, campaign_id, full_name, age, life_status, is_heir, origin)
VALUES
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101',
   'RLS Founder', 40, 'alive', false, 'entrepreneur');

INSERT INTO fd.dynasties (id, campaign_id, name, head_character_id, prestige)
VALUES
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000101',
   'RLS House', '00000000-0000-0000-0000-000000000102', 0);

SET LOCAL fd.telegram_id = '1002';

DO $$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible
    FROM fd.campaigns
   WHERE id = '00000000-0000-0000-0000-000000000101';
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'cross-owner campaign read was not isolated';
  END IF;

  SELECT count(*) INTO v_visible
    FROM fd.characters
   WHERE campaign_id = '00000000-0000-0000-0000-000000000101';
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'cross-owner character read was not isolated';
  END IF;

  BEGIN
    INSERT INTO fd.characters
      (id, campaign_id, full_name, age, life_status, is_heir, origin)
    VALUES
      ('00000000-0000-0000-0000-000000000104',
       '00000000-0000-0000-0000-000000000101',
       'Unauthorized Child', 18, 'alive', false, 'family');
    RAISE EXCEPTION 'cross-owner write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
ROLLBACK;
