-- ============================================================
-- SHERLOCK SCHOLES — test: sweep_stale_rooms()
--
-- Covers the fix from supabase/migrations/sweep_stale_rooms.sql: ten rooms had
-- been stuck in 'playing' since 29 May, and because award_room_stats() hangs
-- off a room reaching 'finished', the statistics for those games were credited
-- nowhere.
--
-- The sweep has two duties that pull in opposite directions, and BOTH are
-- asserted here:
--   * close games nobody is driving any more   (cases A and B)
--   * leave a game that is still being played alone (cases C and D)
--
-- Case C is the one that matters most. A grace period tuned too tight would
-- end the round of a live game under the players' hands, and no amount of
-- "closes stale rooms" testing would notice.
--
-- HOW TO RUN — Supabase SQL Editor, or:
--     psql "$DATABASE_URL" -f supabase/tests/sweep_stale_rooms.test.sql
--
-- SAFETY. The whole script is one transaction ending in ROLLBACK, so no
-- fixture and no sweep effect survives it. Note that sweep_stale_rooms() walks
-- EVERY room, so inside this transaction it will also act on any genuinely
-- stale real room — that is rolled back too, and the assertions below are
-- scoped to the fixtures rather than to the function's return counts, which
-- would otherwise depend on whatever else the database happens to hold.
--
-- Requires: sweep_stale_rooms.sql, end_round_rpc.sql, award_stats_on_finish.sql.
-- On success prints one row: `sweep_stale_rooms: all assertions passed`.
-- On failure the transaction aborts with the failing ASSERT message.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  -- Negative ids: Telegram never issues one, so a fixture can never collide
  -- with a real player even if this somehow escaped its transaction.
  v_player   BIGINT := -999001;
  v_cards    UUID[];
  v_room_a   UUID;  v_team_a UUID;  v_round_a UUID;
  v_room_b   UUID;  v_team_b UUID;
  v_room_c   UUID;  v_team_c UUID;  v_round_c UUID;
  v_room_d   UUID;  v_team_d UUID;
  v_room_e   UUID;  v_team_e UUID;  v_round_e UUID;
  v_status   TEXT;
  v_ended    TIMESTAMPTZ;
  v_points   INT;
BEGIN
  SELECT array_agg(id) INTO v_cards FROM (SELECT id FROM cards LIMIT 3) c;
  ASSERT array_length(v_cards, 1) = 3, 'fixture needs at least 3 cards in the deck';

  INSERT INTO players (id, first_name) VALUES (v_player, 'Sweep Fixture');

  -- ── Case A: abandoned mid-round ──────────────────────────
  -- Round 1 of 1, started 10 minutes ago with a 60-second clock, so it is
  -- overdue by far more than the 120-second grace. Two of three cards were
  -- guessed before everyone closed the app.
  INSERT INTO rooms (code, host_id, status, mode, started_at)
    VALUES ('SWEEPA', v_player, 'playing', 'team', now() - interval '11 minutes')
    RETURNING id INTO v_room_a;
  INSERT INTO teams (room_id, name) VALUES (v_room_a, 'A') RETURNING id INTO v_team_a;
  -- The player has to be IN the room: award_room_stats() credits by walking
  -- room_players, so a fixture without this row would close the room and
  -- credit nobody — which is the very bug being tested for.
  INSERT INTO room_players (room_id, player_id, team_id) VALUES (v_room_a, v_player, v_team_a);
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, started_at, time_seconds)
    VALUES (v_room_a, v_team_a, v_player, 1, 'active', now() - interval '10 minutes', 60)
    RETURNING id INTO v_round_a;
  INSERT INTO round_cards (round_id, card_id, status, card_order) VALUES
    (v_round_a, v_cards[1], 'correct', 1),
    (v_round_a, v_cards[2], 'correct', 2),
    (v_round_a, v_cards[3], 'skipped', 3);

  -- ── Case B: died after the last round was scored ─────────
  -- No active round left, nothing has moved for 10 minutes, room still 'playing'.
  INSERT INTO rooms (code, host_id, status, mode, started_at)
    VALUES ('SWEEPB', v_player, 'playing', 'team', now() - interval '20 minutes')
    RETURNING id INTO v_room_b;
  INSERT INTO teams (room_id, name) VALUES (v_room_b, 'B') RETURNING id INTO v_team_b;
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, started_at, ended_at, time_seconds)
    VALUES (v_room_b, v_team_b, v_player, 1, 'completed',
            now() - interval '11 minutes', now() - interval '10 minutes', 60);

  -- ── Case C: a LIVE game — must not be touched ────────────
  -- The round started 5 seconds ago and has 60 on the clock.
  INSERT INTO rooms (code, host_id, status, mode, started_at)
    VALUES ('SWEEPC', v_player, 'playing', 'team', now() - interval '2 minutes')
    RETURNING id INTO v_room_c;
  INSERT INTO teams (room_id, name) VALUES (v_room_c, 'C') RETURNING id INTO v_team_c;
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, started_at, time_seconds)
    VALUES (v_room_c, v_team_c, v_player, 1, 'active', now() - interval '5 seconds', 60)
    RETURNING id INTO v_round_c;

  -- ── Case D: the pause between two rounds ─────────────────
  -- Idle, but only for 10 seconds — inside SUMMARY_PAUSE_MS + watchdog, and
  -- far inside the 120-second grace. A live client is about to deal round 2.
  INSERT INTO rooms (code, host_id, status, mode, started_at)
    VALUES ('SWEEPD', v_player, 'playing', 'team', now() - interval '5 minutes')
    RETURNING id INTO v_room_d;
  INSERT INTO teams (room_id, name) VALUES (v_room_d, 'D') RETURNING id INTO v_team_d;
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, started_at, ended_at, time_seconds)
    VALUES (v_room_d, v_team_d, v_player, 1, 'completed',
            now() - interval '70 seconds', now() - interval '10 seconds', 60);
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, time_seconds)
    VALUES (v_room_d, v_team_d, v_player, 2, 'pending', 60);

  -- ── Case E: deadline just passed, still inside the grace ──
  -- 60-second clock started 90 seconds ago: overdue by 30, protected by the
  -- 120-second grace. A live client is about to end this round itself.
  INSERT INTO rooms (code, host_id, status, mode, started_at)
    VALUES ('SWEEPE', v_player, 'playing', 'team', now() - interval '3 minutes')
    RETURNING id INTO v_room_e;
  INSERT INTO teams (room_id, name) VALUES (v_room_e, 'E') RETURNING id INTO v_team_e;
  INSERT INTO rounds (room_id, team_id, explainer_id, round_number, status, started_at, time_seconds)
    VALUES (v_room_e, v_team_e, v_player, 1, 'active', now() - interval '90 seconds', 60)
    RETURNING id INTO v_round_e;

  -- ── The sweep ────────────────────────────────────────────
  PERFORM sweep_stale_rooms();

  -- ── Case A: the round was ended, scored, and the room closed ──
  SELECT status, ended_at INTO v_status, v_ended FROM rounds WHERE id = v_round_a;
  ASSERT v_status = 'completed',
    format('A: overdue round should be completed, was %s', v_status);
  ASSERT v_ended IS NOT NULL, 'A: an ended round must carry ended_at';

  SELECT points INTO v_points FROM scores WHERE round_id = v_round_a;
  ASSERT v_points = 2,
    format('A: two correct cards should score 2, scored %s', coalesce(v_points::text, 'NO ROW'));

  -- end_round() finishes the room itself when no pending round follows — that
  -- is what credits statistics through trg_award_room_stats.
  SELECT status, ended_at INTO v_status, v_ended FROM rooms WHERE id = v_room_a;
  ASSERT v_status = 'finished',
    format('A: room with no next round should be finished, was %s', v_status);
  ASSERT v_ended IS NOT NULL, 'A: a finished room must carry ended_at';

  -- The bug that started all this: no player_stats row for a game that never
  -- reached 'finished'. Assert the credit actually landed.
  ASSERT EXISTS (SELECT 1 FROM player_stats WHERE player_id = v_player),
    'A: finishing the room must credit player_stats (award_room_stats)';

  -- ── Case B: abandoned room closed ────────────────────────
  SELECT status, ended_at INTO v_status, v_ended FROM rooms WHERE id = v_room_b;
  ASSERT v_status = 'finished',
    format('B: idle room should be finished, was %s', v_status);
  ASSERT v_ended IS NOT NULL, 'B: a finished room must carry ended_at';

  -- ── Case C: the live game is untouched ───────────────────
  SELECT status INTO v_status FROM rounds WHERE id = v_round_c;
  ASSERT v_status = 'active',
    format('C: a round 5s into a 60s clock must stay active, was %s', v_status);
  ASSERT NOT EXISTS (SELECT 1 FROM scores WHERE round_id = v_round_c),
    'C: a live round must not be scored';

  SELECT status INTO v_status FROM rooms WHERE id = v_room_c;
  ASSERT v_status = 'playing',
    format('C: a live room must stay playing, was %s', v_status);

  -- ── Case D: the pause between rounds is untouched ────────
  SELECT status INTO v_status FROM rooms WHERE id = v_room_d;
  ASSERT v_status = 'playing',
    format('D: a room 10s into the between-round pause must stay playing, was %s', v_status);
  ASSERT (SELECT status FROM rounds WHERE room_id = v_room_d AND round_number = 2) = 'pending',
    'D: the next round must still be waiting for a client to deal it';

  -- ── Case E: the window the grace period exists for ───────
  -- The clock ran out 30 seconds ago, but the game is NOT abandoned: this is
  -- where the client watchdogs fire (4–10 s past the deadline) and where the
  -- between-round pause lives. Only the grace period tells this apart from a
  -- room nobody is in, and the assertions below are what make lowering it a
  -- deliberate act rather than an accident.
  SELECT status INTO v_status FROM rounds WHERE id = v_round_e;
  ASSERT v_status = 'active',
    format('E: a round 30s past its deadline is still inside the grace period, was %s', v_status);

  -- Same row, same moment, grace of zero: now it is swept. The clock alone
  -- does not protect it — the grace period does.
  PERFORM sweep_stale_rooms(0);
  SELECT status INTO v_status FROM rounds WHERE id = v_round_e;
  ASSERT v_status = 'completed',
    'E2: with grace 0 the just-overdue round is ended — the grace period is what protected it';

  -- And the genuinely live round — clock still running — survives even that,
  -- because the deadline itself has not passed.
  SELECT status INTO v_status FROM rounds WHERE id = v_round_c;
  ASSERT v_status = 'active',
    format('C3: a round whose clock is still running survives grace 0, was %s', v_status);

  RAISE NOTICE 'sweep_stale_rooms: all assertions passed';
END;
$test$;

SELECT 'sweep_stale_rooms: all assertions passed' AS result;

ROLLBACK;
