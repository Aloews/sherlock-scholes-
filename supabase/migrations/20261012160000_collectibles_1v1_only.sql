-- Restrict collectible-card progress to 1v1 games only.
-- Clean up any progress/inventory that may have been credited from team rooms.
BEGIN;

DELETE FROM public.player_card_guess_events e
USING public.round_cards rc, public.rounds rd, public.rooms rm
WHERE e.round_card_id = rc.id
  AND rd.id = rc.round_id
  AND rm.id = rd.room_id
  AND rm."mode" <> '1v1';

-- Recompute counters from the remaining 1v1-only event ledger.
DELETE FROM public.player_card_progress;
INSERT INTO public.player_card_progress (player_id, card_id, correct_guesses, last_guessed_at)
SELECT e.player_id, e.card_id, count(*)::integer, max(e.guessed_at)
FROM public.player_card_guess_events e
GROUP BY e.player_id, e.card_id;

-- Remove only unlocks granted by the 100-guesses rule if the qualifying
-- 1v1 history no longer supports them. Preserve any future trades/admin grants.
DELETE FROM public.player_card_collectibles i
WHERE i.acquired_via = '100_correct_guesses'
  AND NOT EXISTS (
    SELECT 1
    FROM public.player_card_progress p
    WHERE p.player_id = i.player_id
      AND p.card_id = i.card_id
      AND p.correct_guesses >= 100
  );

INSERT INTO public.player_card_collectibles (player_id, card_id, acquired_via, acquired_at)
SELECT p.player_id, p.card_id, '100_correct_guesses', p.last_guessed_at
FROM public.player_card_progress p
WHERE p.correct_guesses >= 100
ON CONFLICT (player_id, card_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.credit_collectible_card_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_room_id uuid;
  v_explainer_team_id uuid;
  v_mode text;
  v_player_id bigint;
  v_count integer;
  v_event_player bigint;
BEGIN
  IF NEW.status <> 'correct' OR (TG_OP = 'UPDATE' AND OLD.status = 'correct') THEN
    RETURN NEW;
  END IF;

  SELECT rd.room_id, rd.team_id, rm."mode"
    INTO v_room_id, v_explainer_team_id, v_mode
  FROM public.rounds rd
  JOIN public.rooms rm ON rm.id = rd.room_id
  WHERE rd.id = NEW.round_id;

  -- Collectibles are deliberately 1v1-only. Team games must not contribute
  -- progress to every teammate when the individual guesser is unknown.
  IF v_mode IS DISTINCT FROM '1v1'
     OR v_room_id IS NULL
     OR v_explainer_team_id IS NULL
     OR NEW.card_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- In 1v1, credit only the one opposing player who guessed the card.
  FOR v_player_id IN
    SELECT rp.player_id
    FROM public.room_players rp
    WHERE rp.room_id = v_room_id
      AND rp.team_id IS NOT NULL
      AND rp.team_id <> v_explainer_team_id
  LOOP
    v_event_player := NULL;
    INSERT INTO public.player_card_guess_events (round_card_id, player_id, card_id)
    VALUES (NEW.id, v_player_id, NEW.card_id)
    ON CONFLICT (round_card_id, player_id) DO NOTHING
    RETURNING player_id INTO v_event_player;

    IF v_event_player IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.player_card_progress (player_id, card_id, correct_guesses, last_guessed_at)
    VALUES (v_player_id, NEW.card_id, 1, now())
    ON CONFLICT (player_id, card_id) DO UPDATE
      SET correct_guesses = public.player_card_progress.correct_guesses + 1,
          last_guessed_at = now()
    RETURNING correct_guesses INTO v_count;

    IF v_count >= 100 THEN
      INSERT INTO public.player_card_collectibles (player_id, card_id, acquired_via)
      VALUES (v_player_id, NEW.card_id, '100_correct_guesses')
      ON CONFLICT (player_id, card_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMIT;
