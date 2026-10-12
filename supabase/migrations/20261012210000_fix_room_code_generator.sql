-- Keep the complete six-character room code when returned to the client.
DROP TRIGGER IF EXISTS trigger_set_room_code ON public.rooms;
DROP FUNCTION IF EXISTS public.set_room_code();
DROP FUNCTION IF EXISTS public.generate_room_code();

CREATE FUNCTION public.generate_room_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  taken boolean;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, (floor(random() * length(chars)) + 1)::integer, 1);
    END LOOP;

    SELECT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code)
      INTO taken;
    EXIT WHEN NOT taken;
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE FUNCTION public.set_room_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code::text) = '' THEN
    NEW.code := public.generate_room_code();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_room_code
BEFORE INSERT ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.set_room_code();

UPDATE public.rooms
SET code = public.generate_room_code()
WHERE btrim(code::text) !~ '^[A-HJ-NP-Z2-9]{6}$';
