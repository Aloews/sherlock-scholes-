BEGIN;

DO $$
DECLARE
  v_room public.rooms;
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_code TEXT;
  v_index INTEGER;
BEGIN
  FOR v_index IN 1..100 LOOP
    v_room := public.create_team_room(1001, '{"round_seconds":60,"cards_per_round":5,"total_rounds":3,"categories":null}'::JSONB);
    v_code := btrim(v_room.code::TEXT);

    IF length(v_code) <> 6 OR v_code !~ '^[A-Z0-9]{6}$' THEN
      RAISE EXCEPTION 'team room code is not six uppercase alphanumeric characters: % (length %)', v_code, length(v_code);
    END IF;
    IF v_code = ANY(v_codes) THEN
      RAISE EXCEPTION 'duplicate room code generated: %', v_code;
    END IF;
    v_codes := array_append(v_codes, v_code);
  END LOOP;

  v_room := public.create_1v1_room(1001, '{"round_seconds":60,"cards_per_round":100,"total_rounds":3,"categories":null}'::JSONB);
  v_code := btrim(v_room.code::TEXT);
  IF length(v_code) <> 6 OR v_code !~ '^[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION '1v1 room code is not six uppercase alphanumeric characters: % (length %)', v_code, length(v_code);
  END IF;
  IF v_room.mode <> '1v1' THEN
    RAISE EXCEPTION '1v1 creator returned unexpected mode: %', v_room.mode;
  END IF;

  IF cardinality(v_codes) <> 100 THEN
    RAISE EXCEPTION 'expected 100 unique team room codes, got %', cardinality(v_codes);
  END IF;
END;
$$;

ROLLBACK;
