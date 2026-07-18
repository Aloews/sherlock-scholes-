CREATE OR REPLACE FUNCTION create_team_room(
  p_host_id  BIGINT,
  p_settings JSONB DEFAULT '{"round_seconds":60,"cards_per_round":5,"total_rounds":3,"categories":null}'
) RETURNS rooms AS $$
DECLARE
  v_room   rooms;
  v_teamA  teams;
BEGIN
  INSERT INTO rooms (host_id, settings, code, mode)
  VALUES (p_host_id, p_settings, '', 'team')
  RETURNING * INTO v_room;

  INSERT INTO teams (room_id, name, color) VALUES (v_room.id, 'Команда А', '#22c55e')
  RETURNING * INTO v_teamA;
  INSERT INTO teams (room_id, name, color) VALUES (v_room.id, 'Команда Б', '#3b82f6');

  INSERT INTO room_players (room_id, player_id, team_id)
  VALUES (v_room.id, p_host_id, NULL);

  RETURN v_room;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_team_room(BIGINT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION create_team_room(BIGINT, JSONB) TO authenticated;
