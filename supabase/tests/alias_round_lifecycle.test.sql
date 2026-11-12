-- Integration contract tests for end_round(), pause_round(), and resume_round().
-- Run after the isolated setup and the two production SQL function definitions.
BEGIN;

DO $test$
DECLARE
  v_result RECORD;
  v_pause RECORD;
  v_points INTEGER;
  v_count INTEGER;
  v_status TEXT;
  v_ended TIMESTAMPTZ;
  v_original_pause TIMESTAMPTZ;
BEGIN
  ASSERT public.max_round_pause_ms() = 120000,
    'the pause allowance must remain two minutes';

  ASSERT NOT has_function_privilege('anon', 'public.end_round(uuid)', 'EXECUTE'),
    'anonymous clients must not call the unauthenticated legacy round RPC';
  ASSERT NOT has_function_privilege('authenticated', 'public.end_round(uuid)', 'EXECUTE'),
    'authenticated clients must use the verified Rust API for round completion';
  ASSERT has_function_privilege('service_role', 'public.end_round(uuid)', 'EXECUTE'),
    'the trusted server role retains the legacy SQL function permission';

  -- A non-final round claims once, counts only correct cards, upserts the
  -- score, and returns the pending next round without activating it.
  INSERT INTO public.rooms (id, status) VALUES
    ('00000000-0000-4000-8000-000000000001', 'playing');
  INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
  VALUES
    ('00000000-0000-4000-8000-000000000011',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000101', 1, 'active', 7),
    ('00000000-0000-4000-8000-000000000012',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000102', 2, 'pending', 8);
  INSERT INTO public.round_cards (id, round_id, status) VALUES
    ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000011', 'correct'),
    ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000011', 'skipped'),
    ('00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000011', 'correct'),
    ('00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000011', 'pending');
  INSERT INTO public.scores (room_id, team_id, round_id, points)
  VALUES (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000011',
    99
  );

  SELECT * INTO v_result
    FROM public.end_round('00000000-0000-4000-8000-000000000011');
  ASSERT v_result.outcome = 'next_round', 'non-final round must return next_round';
  ASSERT v_result.next_round_id = '00000000-0000-4000-8000-000000000012',
    'end_round must return the immediately following pending round';
  SELECT points INTO v_points FROM public.scores
   WHERE round_id = '00000000-0000-4000-8000-000000000011';
  ASSERT v_points = 2, 'score must be replaced with the count of correct cards';
  SELECT count(*) INTO v_count FROM public.scores
   WHERE round_id = '00000000-0000-4000-8000-000000000011';
  ASSERT v_count = 1, 'a round must have exactly one score row';
  ASSERT (SELECT status FROM public.rounds
           WHERE id = '00000000-0000-4000-8000-000000000012') = 'pending',
    'end_round must leave dealing and next-round activation to the client';
  ASSERT (SELECT status FROM public.rooms
           WHERE id = '00000000-0000-4000-8000-000000000001') = 'playing',
    'a room with a next round must remain playing';

  SELECT * INTO v_result
    FROM public.end_round('00000000-0000-4000-8000-000000000011');
  ASSERT v_result.outcome = 'already_ended',
    'a duplicate end_round call must be idempotent';
  SELECT count(*) INTO v_count FROM public.scores
   WHERE round_id = '00000000-0000-4000-8000-000000000011';
  ASSERT v_count = 1, 'duplicate end_round must not duplicate score rows';

  -- A final round closes the room in the same transaction.
  INSERT INTO public.rooms (id, status) VALUES
    ('00000000-0000-4000-8000-000000000002', 'playing');
  INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
  VALUES (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000201',
    1, 'active', 7
  );
  INSERT INTO public.round_cards (id, round_id, status)
  VALUES ('00000000-0000-4000-8000-000000000121',
          '00000000-0000-4000-8000-000000000021', 'correct');
  SELECT * INTO v_result
    FROM public.end_round('00000000-0000-4000-8000-000000000021');
  ASSERT v_result.outcome = 'game_end', 'final round must return game_end';
  SELECT status, ended_at INTO v_status, v_ended
    FROM public.rooms WHERE id = '00000000-0000-4000-8000-000000000002';
  ASSERT v_status = 'finished' AND v_ended IS NOT NULL,
    'final round must finish the room and set ended_at';

  -- Pause is authenticated by signed initData, explainer-only, and idempotent.
  INSERT INTO public.rooms (id, status) VALUES
    ('00000000-0000-4000-8000-000000000003', 'playing');
  INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
  VALUES (
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000301',
    1, 'active', 7
  );

  SELECT * INTO v_pause
    FROM public.pause_round('00000000-0000-4000-8000-000000000031', 'valid-explainer');
  ASSERT v_pause.paused_at IS NOT NULL, 'explainer pause must set paused_at';
  v_original_pause := v_pause.paused_at;
  SELECT * INTO v_pause
    FROM public.pause_round('00000000-0000-4000-8000-000000000031', 'valid-explainer');
  ASSERT v_pause.paused_at = v_original_pause,
    'repeated pause must not restart the pause window';

  BEGIN
    PERFORM 1 FROM public.pause_round(
      '00000000-0000-4000-8000-000000000031', 'invalid-init-data'
    );
    RAISE EXCEPTION 'invalid initData unexpectedly paused a round';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;

  BEGIN
    PERFORM 1 FROM public.pause_round(
      '00000000-0000-4000-8000-000000000031', 'valid-other'
    );
    RAISE EXCEPTION 'a non-explainer unexpectedly paused a round';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM 1 FROM public.resume_round(
      '00000000-0000-4000-8000-000000000031', 'valid-other'
    );
    RAISE EXCEPTION 'a non-explainer unexpectedly resumed a round';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Simulate elapsed wall time deterministically; now() is transaction-stable,
  -- so moving paused_at is more reliable than sleeping inside this transaction.
  UPDATE public.rounds
     SET paused_at = now() - interval '250 milliseconds'
   WHERE id = '00000000-0000-4000-8000-000000000031';
  SELECT * INTO v_pause
    FROM public.resume_round('00000000-0000-4000-8000-000000000031', 'valid-explainer');
  ASSERT v_pause.paused_at IS NULL, 'resume must clear paused_at';
  ASSERT v_pause.paused_ms BETWEEN 1 AND 120000,
    'resume must fold elapsed pause time into paused_ms';

  -- A pause already at the cap cannot be extended, and a currently held pause
  -- is clamped when resumed after its remaining allowance has elapsed.
  INSERT INTO public.rooms (id, status) VALUES
    ('00000000-0000-4000-8000-000000000004', 'playing');
  INSERT INTO public.rounds (
    id, room_id, team_id, round_number, status, explainer_id, paused_ms, paused_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000041',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000401',
    1, 'active', 7, 119900, now() - interval '5 seconds'
  );
  SELECT * INTO v_pause
    FROM public.resume_round('00000000-0000-4000-8000-000000000041', 'valid-explainer');
  ASSERT v_pause.paused_at IS NULL AND v_pause.paused_ms = 120000,
    'resume must clamp accumulated pause to the two-minute cap';
  SELECT * INTO v_pause
    FROM public.pause_round('00000000-0000-4000-8000-000000000041', 'valid-explainer');
  ASSERT v_pause.paused_at IS NULL AND v_pause.paused_ms = 120000,
    'a round at the pause cap must refuse another pause';

  -- Inactive rounds are not paused, and resuming an unpaused round is harmless.
  INSERT INTO public.rooms (id, status) VALUES
    ('00000000-0000-4000-8000-000000000005', 'playing');
  INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
  VALUES (
    '00000000-0000-4000-8000-000000000051',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000501',
    1, 'completed', 7
  );
  SELECT * INTO v_pause
    FROM public.pause_round('00000000-0000-4000-8000-000000000051', 'valid-explainer');
  ASSERT v_pause.paused_at IS NULL, 'inactive rounds must not be paused';
  SELECT * INTO v_pause
    FROM public.resume_round('00000000-0000-4000-8000-000000000051', 'valid-explainer');
  ASSERT v_pause.paused_at IS NULL AND v_pause.paused_ms = 0,
    'resuming an unpaused round must be idempotent';
END;
$test$;

ROLLBACK;
