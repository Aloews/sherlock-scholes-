DO $$
DECLARE
  v_rls boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.player_presence'::regclass;
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'player_presence must have RLS enabled';
  END IF;

  IF has_table_privilege('anon', 'public.player_presence', 'SELECT')
     OR has_table_privilege('anon', 'public.player_presence', 'INSERT')
     OR has_table_privilege('anon', 'public.player_presence', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.player_presence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_presence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.player_presence', 'UPDATE') THEN
    RAISE EXCEPTION 'client roles must not access player_presence directly';
  END IF;

  IF has_function_privilege('anon', 'public.increment_player_stats(bigint,integer,integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_player_stats(bigint,integer,integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client roles must not execute increment_player_stats directly';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.increment_player_stats(bigint,integer,integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain internal stats RPC privilege';
  END IF;

  -- The public retry RPC may award a room only after it is finished.
  INSERT INTO public.rooms (id, status) VALUES ('00000000-0000-0000-0000-000000000123', 'waiting');
  IF public.award_room_stats('00000000-0000-0000-0000-000000000123') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unfinished rooms must not receive stats awards';
  END IF;
  IF (SELECT stats_awarded_at FROM public.rooms WHERE id = '00000000-0000-0000-0000-000000000123') IS NOT NULL THEN
    RAISE EXCEPTION 'unfinished room stats claim must remain unset';
  END IF;

  UPDATE public.rooms SET status = 'finished' WHERE id = '00000000-0000-0000-0000-000000000123';
  IF public.award_room_stats('00000000-0000-0000-0000-000000000123') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'finished room should be eligible for one stats award';
  END IF;
  IF public.award_room_stats('00000000-0000-0000-0000-000000000123') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'stats award must remain idempotent';
  END IF;

END $;
