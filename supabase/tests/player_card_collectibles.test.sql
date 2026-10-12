-- Runs against the disposable schema created by player_rating_cache_test_setup.sql.
BEGIN;

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS category_ru text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE public.round_cards ADD COLUMN IF NOT EXISTS card_id uuid;
ALTER TABLE public.round_cards ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.room_players ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.tg_validate_init_data(text)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN $1 ~ '^[0-9]+$' THEN $1::bigint ELSE NULL END
$$;

INSERT INTO public.cards (id, name, name_en, category, active)
VALUES ('00000000-0000-0000-0000-000000000101', 'Тестовый игрок', 'Test Player', 'player', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rooms (id, status) VALUES ('00000000-0000-0000-0000-000000000201', 'playing')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.rounds (id, room_id, explainer_id, team_id)
VALUES ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-000000000201', 10,
        '00000000-0000-0000-0000-000000000401')
ON CONFLICT (id) DO UPDATE SET team_id = EXCLUDED.team_id;
INSERT INTO public.room_players (room_id, player_id, team_id)
VALUES ('00000000-0000-0000-0000-000000000201', 10, '00000000-0000-0000-0000-000000000401'),
       ('00000000-0000-0000-0000-000000000201', 20, '00000000-0000-0000-0000-000000000402')
ON CONFLICT DO NOTHING;

-- A skipped card does not grant progress. Correcting it credits the opposing
-- team once; a repeated UPDATE to correct cannot inflate the count.
INSERT INTO public.round_cards (round_id, card_id, status)
VALUES ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-000000000101', 'pending');
UPDATE public.round_cards
SET status = 'skipped'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101';
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.player_card_progress WHERE player_id = 20) THEN
    RAISE EXCEPTION 'skipped cards must not count toward collectibles';
  END IF;
END $do$;
UPDATE public.round_cards
SET status = 'correct'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101';
UPDATE public.round_cards
SET status = 'correct'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101';
DO $do$
BEGIN
  IF (SELECT correct_guesses FROM public.player_card_progress WHERE player_id = 20 AND card_id = '00000000-0000-0000-0000-000000000101') <> 1 THEN
    RAISE EXCEPTION 'a correct transition must be credited exactly once';
  END IF;
  IF EXISTS (SELECT 1 FROM public.player_card_progress WHERE player_id = 10) THEN
    RAISE EXCEPTION 'the explaining team must not receive guessing progress';
  END IF;
  IF has_table_privilege('anon', 'public.player_card_collectibles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_card_collectibles', 'SELECT') THEN
    RAISE EXCEPTION 'inventory table must not be directly readable by client roles';
  END IF;
  IF NOT has_function_privilege('anon', 'public.my_card_collectibles(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verified inventory RPC must be executable by anon';
  END IF;
  IF has_table_privilege('anon', 'public.player_card_progress', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_card_progress', 'SELECT')
     OR has_table_privilege('anon', 'public.player_card_guess_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_card_guess_events', 'SELECT') THEN
    RAISE EXCEPTION 'progress and event ledger tables must not be directly readable by client roles';
  END IF;
  IF NOT has_function_privilege('anon', 'public.my_card_collectible_progress(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verified progress RPC must be executable by anon';
  END IF;
END $do$;

-- A status toggle must not create a second credit for the same round-card.
UPDATE public.round_cards SET status = 'skipped'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101';
UPDATE public.round_cards SET status = 'correct'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101';
DO $do$
BEGIN
  IF (SELECT correct_guesses FROM public.player_card_progress WHERE player_id = 20 AND card_id = '00000000-0000-0000-0000-000000000101') <> 1 THEN
    RAISE EXCEPTION 'status toggles must not double-credit a round-card';
  END IF;
END $do$;

-- A second round-card for the same card supplies the 100th correct guess.
UPDATE public.player_card_progress SET correct_guesses = 99
WHERE player_id = 20 AND card_id = '00000000-0000-0000-0000-000000000101';
INSERT INTO public.round_cards (round_id, card_id, status)
VALUES ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-000000000101', 'pending');
UPDATE public.round_cards SET status = 'correct'
WHERE round_id = '00000000-0000-0000-0000-000000000301'
  AND card_id = '00000000-0000-0000-0000-000000000101'
  AND status = 'pending';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.player_card_collectibles WHERE player_id = 20 AND card_id = '00000000-0000-0000-0000-000000000101') THEN
    RAISE EXCEPTION '100th correct guess must unlock collectible';
  END IF;
END $do$;

ROLLBACK;
