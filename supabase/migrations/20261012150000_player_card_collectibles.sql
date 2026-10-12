-- Collectible cards: unlock a card after 100 correct guesses in 1v1 only.
-- Team games are excluded because the individual guesser is not identifiable.
-- Attribution is server-side and idempotent: only pending/skipped -> correct
-- status transitions can increment progress once.
BEGIN;

CREATE TABLE IF NOT EXISTS public.player_card_progress (
  player_id bigint NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  correct_guesses integer NOT NULL DEFAULT 0 CHECK (correct_guesses >= 0),
  last_guessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, card_id)
);

CREATE TABLE IF NOT EXISTS public.player_card_collectibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id bigint NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquired_via text NOT NULL DEFAULT '100_correct_guesses'
    CHECK (acquired_via IN ('100_correct_guesses', 'trade', 'admin_grant')),
  UNIQUE (player_id, card_id)
);

CREATE TABLE IF NOT EXISTS public.player_card_guess_events (
  round_card_id uuid NOT NULL REFERENCES public.round_cards(id) ON DELETE CASCADE,
  player_id bigint NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  guessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_card_id, player_id)
);

CREATE INDEX IF NOT EXISTS player_card_progress_owner_count_idx
  ON public.player_card_progress (player_id, correct_guesses DESC);
CREATE INDEX IF NOT EXISTS player_card_collectibles_owner_date_idx
  ON public.player_card_collectibles (player_id, acquired_at DESC);

-- Preserve legitimate history from completed rounds before this feature shipped.
-- The production dataset is small enough for a single transactional backfill;
-- the event primary key makes re-running the migration safe.
INSERT INTO public.player_card_guess_events (round_card_id, player_id, card_id, guessed_at)
SELECT rc.id, rp.player_id, rc.card_id,
       coalesce(rc.decided_at, r.ended_at, r.started_at, now())
FROM public.round_cards rc
JOIN public.rounds r ON r.id = rc.round_id
JOIN public.rooms rm ON rm.id = r.room_id AND rm.mode = '1v1'
JOIN public.room_players rp
  ON rp.room_id = r.room_id
 AND rp.team_id IS NOT NULL
 AND rp.team_id <> r.team_id
WHERE rc.status = 'correct'
ON CONFLICT (round_card_id, player_id) DO NOTHING;

INSERT INTO public.player_card_progress (player_id, card_id, correct_guesses, last_guessed_at)
SELECT e.player_id, e.card_id, count(*)::integer, max(e.guessed_at)
FROM public.player_card_guess_events e
GROUP BY e.player_id, e.card_id
ON CONFLICT (player_id, card_id) DO UPDATE
SET correct_guesses = greatest(public.player_card_progress.correct_guesses, EXCLUDED.correct_guesses),
    last_guessed_at = greatest(public.player_card_progress.last_guessed_at, EXCLUDED.last_guessed_at);

INSERT INTO public.player_card_collectibles (player_id, card_id, acquired_via, acquired_at)
SELECT p.player_id, p.card_id, '100_correct_guesses', p.last_guessed_at
FROM public.player_card_progress p
WHERE p.correct_guesses >= 100
ON CONFLICT (player_id, card_id) DO NOTHING;

ALTER TABLE public.player_card_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_card_collectibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_card_guess_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_card_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_card_collectibles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_card_guess_events FROM PUBLIC, anon, authenticated;

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
  v_player record;
  v_count integer;
  v_event_player bigint;
BEGIN
  IF NEW.status <> 'correct' OR (TG_OP = 'UPDATE' AND OLD.status = 'correct') THEN
    RETURN NEW;
  END IF;

  SELECT r.room_id, r.team_id, rm.mode
    INTO v_room_id, v_explainer_team_id, v_mode
  FROM public.rounds r
  JOIN public.rooms rm ON rm.id = r.room_id
  WHERE r.id = NEW.round_id;

  IF v_mode IS DISTINCT FROM '1v1'
     OR v_room_id IS NULL
     OR v_explainer_team_id IS NULL
     OR NEW.card_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- In 1v1, the opposing team_id belongs to exactly one guessing player.
  FOR v_player IN
    SELECT rp.player_id
    FROM public.room_players rp
    WHERE rp.room_id = v_room_id
      AND rp.team_id IS NOT NULL
      AND rp.team_id <> v_explainer_team_id
  LOOP
    v_event_player := NULL;
    INSERT INTO public.player_card_guess_events (round_card_id, player_id, card_id)
    VALUES (NEW.id, v_player.player_id, NEW.card_id)
    ON CONFLICT (round_card_id, player_id) DO NOTHING
    RETURNING player_id INTO v_event_player;

    -- A round-card can be toggled by clients; its unique ledger row ensures
    -- one card contributes at most once to each player's progress per round.
    IF v_event_player IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.player_card_progress (player_id, card_id, correct_guesses, last_guessed_at)
    VALUES (v_player.player_id, NEW.card_id, 1, now())
    ON CONFLICT (player_id, card_id) DO UPDATE
      SET correct_guesses = public.player_card_progress.correct_guesses + 1,
          last_guessed_at = now()
    RETURNING correct_guesses INTO v_count;

    IF v_count >= 100 THEN
      INSERT INTO public.player_card_collectibles (player_id, card_id, acquired_via)
      VALUES (v_player.player_id, NEW.card_id, '100_correct_guesses')
      ON CONFLICT (player_id, card_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_credit_collectible_card_progress ON public.round_cards;
CREATE TRIGGER trg_credit_collectible_card_progress
AFTER UPDATE OF status ON public.round_cards
FOR EACH ROW
WHEN (NEW.status = 'correct' AND OLD.status IS DISTINCT FROM 'correct')
EXECUTE FUNCTION public.credit_collectible_card_progress();

CREATE OR REPLACE FUNCTION public.my_card_collectibles(p_init_data text)
RETURNS TABLE (
  card_id uuid,
  name text,
  name_en text,
  category text,
  category_ru text,
  photo_url text,
  tier text,
  correct_guesses integer,
  acquired_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.name_en, c.category, c.category_ru,
         c.photo_url, c.tier, p.correct_guesses, i.acquired_at
  FROM public.player_card_collectibles i
  JOIN public.cards c ON c.id = i.card_id
  JOIN public.player_card_progress p
    ON p.player_id = i.player_id AND p.card_id = i.card_id
  WHERE i.player_id = v_me
  ORDER BY i.acquired_at DESC, c.name;
END;
$function$;


CREATE OR REPLACE FUNCTION public.my_card_collectible_progress(p_init_data text)
RETURNS TABLE (
  card_id uuid,
  name text,
  name_en text,
  category text,
  category_ru text,
  photo_url text,
  tier text,
  correct_guesses integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.name_en, c.category, c.category_ru,
         c.photo_url, c.tier, p.correct_guesses
  FROM public.player_card_progress p
  JOIN public.cards c ON c.id = p.card_id
  WHERE p.player_id = v_me
    AND p.correct_guesses < 100
    AND NOT EXISTS (
      SELECT 1 FROM public.player_card_collectibles i
      WHERE i.player_id = v_me AND i.card_id = p.card_id
    )
  ORDER BY p.correct_guesses DESC, p.last_guessed_at DESC, c.name
  LIMIT 3;
END;
$function$;

REVOKE ALL ON FUNCTION public.credit_collectible_card_progress() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_card_collectibles(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_card_collectibles(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.my_card_collectible_progress(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_card_collectible_progress(text) TO anon, authenticated;

COMMIT;
