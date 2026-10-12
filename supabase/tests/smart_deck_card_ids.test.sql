-- Regression: exact card IDs constrain the same predicate used by count and deal.
DO $$
DECLARE
  v_id text;
  v_count bigint;
  v_rows integer;
  v_other_id text;
BEGIN
  SELECT id::text INTO v_id FROM public.cards WHERE active AND category = 'player' ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Cannot test card_ids: no active cards';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cards_matching(jsonb_build_object('card_ids', jsonb_build_array(v_id)));
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'card_ids must return exactly one active canonical card, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cards_matching(jsonb_build_object('card_ids', jsonb_build_array('not-a-real-card-id')));
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown card_ids must return no cards, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cards_matching(jsonb_build_object('card_ids', jsonb_build_array(v_id), 'categories', jsonb_build_array('player')));
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'card_ids combined with matching category must return one card, got %', v_count;
  END IF;
END $$;
