-- Regression test for delete_unjoined_rooms().
-- Run in the Supabase SQL editor or with psql. All fixtures and cleanup effects
-- are rolled back, including any other stale rooms encountered by the sweep.
BEGIN;

DO $test$
DECLARE
  v_host bigint := -999921;
  v_guest bigint := -999922;
  v_fresh_host bigint := -999923;
  v_stale_empty uuid;
  v_stale_joined uuid;
  v_fresh_empty uuid;
  v_playing_empty uuid;
BEGIN
  INSERT INTO public.players (id, first_name) VALUES
    (v_host, 'Cleanup Host'),
    (v_guest, 'Cleanup Guest'),
    (v_fresh_host, 'Fresh Host');

  INSERT INTO public.rooms (code, host_id, status, mode, created_at)
    VALUES ('CLN001', v_host, 'waiting', 'team', now() - interval '4 minutes')
    RETURNING id INTO v_stale_empty;

  INSERT INTO public.rooms (code, host_id, status, mode, created_at)
    VALUES ('CLN002', v_host, 'waiting', 'team', now() - interval '4 minutes')
    RETURNING id INTO v_stale_joined;
  INSERT INTO public.room_players (room_id, player_id)
    VALUES (v_stale_joined, v_host), (v_stale_joined, v_guest);

  INSERT INTO public.rooms (code, host_id, status, mode, created_at)
    VALUES ('CLN003', v_fresh_host, 'waiting', '1v1', now() - interval '1 minute')
    RETURNING id INTO v_fresh_empty;

  INSERT INTO public.rooms (code, host_id, status, mode, created_at)
    VALUES ('CLN004', v_host, 'playing', 'team', now() - interval '10 minutes')
    RETURNING id INTO v_playing_empty;

  PERFORM public.delete_unjoined_rooms();

  ASSERT NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = v_stale_empty),
    'stale waiting room without a guest should be deleted';
  ASSERT EXISTS (SELECT 1 FROM public.rooms WHERE id = v_stale_joined),
    'stale waiting room with a guest must remain';
  ASSERT EXISTS (SELECT 1 FROM public.rooms WHERE id = v_fresh_empty),
    'fresh waiting room must remain';
  ASSERT EXISTS (SELECT 1 FROM public.rooms WHERE id = v_playing_empty),
    'playing room must remain';
END;
$test$;

ROLLBACK;
