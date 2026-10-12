BEGIN;

DO $test$
DECLARE
  i integer;
  v_room_id uuid;
  v_code text;
  v_count integer;
BEGIN
  FOR i IN 1..100 LOOP
    v_room_id := gen_random_uuid();
    INSERT INTO public.rooms (id, status, code)
    VALUES (v_room_id, 'waiting', '')
    RETURNING btrim(code::text) INTO v_code;

    IF v_code !~ '^[A-HJ-NP-Z2-9]{6}$' OR length(v_code) <> 6 THEN
      RAISE EXCEPTION 'room code must contain six valid characters; got %', v_code;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM (
    SELECT btrim(code::text) AS code
    FROM public.rooms
    WHERE status = 'waiting'
    GROUP BY btrim(code::text)
    HAVING count(*) > 1
  ) duplicates;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'duplicate room codes detected';
  END IF;

  IF length(public.generate_room_code()) <> 6
     OR public.generate_room_code() !~ '^[A-HJ-NP-Z2-9]{6}$' THEN
    RAISE EXCEPTION 'generate_room_code() did not return a valid six-character code';
  END IF;
END;
$test$;

ROLLBACK;
