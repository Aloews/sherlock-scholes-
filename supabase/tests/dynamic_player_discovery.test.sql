BEGIN;
DO $$
DECLARE first_id uuid; second_id uuid; total integer;
BEGIN
  first_id := public.upsert_discovered_player_card(
    'Q12345', 'Тестовый футболист', 'Test Footballer', '2000-01-02',
    'Россия', 'Нападающий',
    'https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg',
    ARRAY['footballer'], jsonb_build_object('source','wikidata')
  );
  second_id := public.upsert_discovered_player_card(
    'Q12345', 'Другое имя', 'Different Name', '2000-01-02',
    'Россия', 'Нападающий', NULL, ARRAY['women'], jsonb_build_object('verified',true)
  );
  IF first_id <> second_id THEN RAISE EXCEPTION 'same QID created duplicate canonical cards'; END IF;
  SELECT count(*) INTO total FROM public.cards WHERE wikidata_qid='Q12345';
  IF total <> 1 THEN RAISE EXCEPTION 'expected one canonical card, found %', total; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cards WHERE id=first_id AND category='player'
      AND name='Тестовый футболист' AND name_en='Test Footballer'
      AND photo_source='wikidata' AND tags @> ARRAY['footballer','women']
      AND facts @> '{"source":"wikidata","verified":true}'::jsonb
  ) THEN RAISE EXCEPTION 'canonical card did not preserve source-backed data'; END IF;
  IF has_function_privilege('anon', 'public.upsert_discovered_player_card(text,text,text,date,text,text,text,text[],jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute privileged canonical-card RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.upsert_discovered_player_card(text,text,text,date,text,text,text,text[],jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute privileged canonical-card RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.upsert_discovered_player_card(text,text,text,date,text,text,text,text[],jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute canonical-card RPC';
  END IF;
END $$;
DO $$
BEGIN
  BEGIN
    PERFORM public.upsert_discovered_player_card('not-a-qid', 'Invalid', NULL, NULL, NULL, NULL, NULL, ARRAY[]::text[], '{}'::jsonb);
    RAISE EXCEPTION 'invalid QID was accepted';
  EXCEPTION WHEN invalid_parameter_value OR raise_exception THEN
    IF SQLERRM = 'invalid QID was accepted' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
