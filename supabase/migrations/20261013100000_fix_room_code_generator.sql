CREATE OR REPLACE FUNCTION public.generate_room_code_text()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  chars CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  taken BOOLEAN;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, (floor(random() * length(chars)) + 1)::INT, 1);
    END LOOP;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_code, 0));
    SELECT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code) INTO taken;
    EXIT WHEN NOT taken;
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_room_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.generate_room_code_text();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_room_code ON public.rooms;
CREATE TRIGGER trigger_set_room_code
  BEFORE INSERT ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_room_code();

CREATE OR REPLACE FUNCTION public.create_team_room(
  p_host_id BIGINT,
  p_settings JSONB DEFAULT '{"round_seconds":60,"cards_per_round":5,"total_rounds":3,"categories":null}'
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_team_a public.teams;
BEGIN
  INSERT INTO public.rooms (host_id, settings, code, mode)
  VALUES (p_host_id, p_settings, public.generate_room_code_text(), 'team')
  RETURNING * INTO v_room;
  INSERT INTO public.teams (room_id, name, color)
  VALUES (v_room.id, 'Команда А', '#22c55e')
  RETURNING * INTO v_team_a;
  INSERT INTO public.teams (room_id, name, color)
  VALUES (v_room.id, 'Команда Б', '#3b82f6');
  INSERT INTO public.room_players (room_id, player_id, team_id)
  VALUES (v_room.id, p_host_id, NULL);
  RETURN v_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_1v1_room(
  p_host_id BIGINT,
  p_settings JSONB DEFAULT '{"round_seconds":60,"cards_per_round":100,"total_rounds":3,"categories":null}'
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_team public.teams;
  v_name TEXT;
BEGIN
  SELECT first_name INTO v_name FROM public.players WHERE id = p_host_id;
  INSERT INTO public.rooms (host_id, settings, code, mode)
  VALUES (p_host_id, p_settings, public.generate_room_code_text(), '1v1')
  RETURNING * INTO v_room;
  INSERT INTO public.teams (room_id, name, color)
  VALUES (v_room.id, COALESCE(v_name, 'Player 1'), '#22c55e')
  RETURNING * INTO v_team;
  INSERT INTO public.room_players (room_id, player_id, team_id)
  VALUES (v_room.id, p_host_id, v_team.id);
  RETURN v_room;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_team_room(BIGINT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_1v1_room(BIGINT, JSONB) TO anon, authenticated;
