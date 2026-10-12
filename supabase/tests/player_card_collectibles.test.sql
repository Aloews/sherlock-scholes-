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

INSERT INTO public.rooms (id, status, mode) VALUES ('00000000-0000-0000-0000-000000000201', 'playing', '1v1')
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

-- A skipped card does not grant progress. In 1v1, correcting it credits
-- only the opposing player once; repeated status changes cannot inflate it.
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

SELECT count(*) FROM public.my_card_collectibles('20');
SELECT count(*) FROM public.my_card_collectible_progress('20');


-- Team mode must never contribute to collectible progress for either teammate.
INSERT INTO public.rooms (id, status, mode)
VALUES ('00000000-0000-0000-0000-000000000202', 'playing', 'team')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.rounds (id, room_id, explainer_id, team_id)
VALUES ('00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-000000000202', 30,
        '00000000-0000-0000-0000-000000000403')
ON CONFLICT (id) DO UPDATE SET team_id = EXCLUDED.team_id;
INSERT INTO public.room_players (room_id, player_id, team_id)
VALUES ('00000000-0000-0000-0000-000000000202', 30, '00000000-0000-0000-0000-000000000403'),
       ('00000000-0000-0000-0000-000000000202', 40, '00000000-0000-0000-0000-000000000404')
ON CONFLICT DO NOTHING;
INSERT INTO public.round_cards (round_id, card_id, status)
VALUES ('00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-000000000101', 'pending');
UPDATE public.round_cards SET status = 'correct'
WHERE round_id = '00000000-0000-0000-0000-000000000302'
  AND card_id = '00000000-0000-0000-0000-000000000101';
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.player_card_progress WHERE player_id IN (30, 40)
  ) THEN
    RAISE EXCEPTION 'team games must not grant collectible progress';
  END IF;
END $do$;


-- Player-to-player trades: proposal, recipient-only acceptance, atomic swap,
-- decline/cancel, friend-only inventory visibility, and private table access.
INSERT INTO public.players (id, first_name, last_name)
VALUES (10, 'Sender', NULL), (20, 'Receiver', NULL), (30, 'Stranger', NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.friendships (player_id, friend_id)
VALUES (10, 20)
ON CONFLICT DO NOTHING;

INSERT INTO public.cards (id, name, name_en, category, active)
VALUES
 ('00000000-0000-0000-0000-000000000102', 'Trade Card A', 'Trade Card A', 'player', true),
 ('00000000-0000-0000-0000-000000000103', 'Trade Card B', 'Trade Card B', 'player', true),
 ('00000000-0000-0000-0000-000000000104', 'Trade Card C', 'Trade Card C', 'player', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.player_card_collectibles (player_id, card_id, acquired_via)
VALUES
 (10, '00000000-0000-0000-0000-000000000102', 'admin_grant'),
 (10, '00000000-0000-0000-0000-000000000104', 'admin_grant'),
 (20, '00000000-0000-0000-0000-000000000103', 'admin_grant')
ON CONFLICT (player_id, card_id) DO NOTHING;

DO $trade_test$
DECLARE
  v_offer_asset uuid;
  v_requested_asset uuid;
  v_second_offer_asset uuid;
  v_trade_id uuid;
  v_trade_two uuid;
  v_trade_three uuid;
BEGIN
  SELECT id INTO v_offer_asset FROM public.player_card_collectibles
  WHERE player_id = 10 AND card_id = '00000000-0000-0000-0000-000000000102';
  SELECT id INTO v_requested_asset FROM public.player_card_collectibles
  WHERE player_id = 20 AND card_id = '00000000-0000-0000-0000-000000000101';

  IF v_offer_asset IS NULL OR v_requested_asset IS NULL THEN
    RAISE EXCEPTION 'trade fixtures were not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.my_card_tradeable_collectibles('10')
    WHERE collectible_id = v_offer_asset
  ) THEN
    RAISE EXCEPTION 'owner should be able to see their own tradeable asset';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_collectible_inventory('10', 20)
    WHERE card_id = '00000000-0000-0000-0000-000000000101'
  ) THEN
    RAISE EXCEPTION 'friend inventory should expose the requested card';
  END IF;

  v_trade_id := public.create_player_card_trade(
    '10', 20, v_offer_asset, '00000000-0000-0000-0000-000000000101'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.my_player_card_trades('20')
    WHERE trade_id = v_trade_id AND direction = 'incoming' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'recipient should see the pending offer';
  END IF;

  BEGIN
    PERFORM public.respond_player_card_trade('10', v_trade_id, true);
    RAISE EXCEPTION 'sender must not be allowed to accept their own offer';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_TRADE_RECIPIENT%' THEN RAISE; END IF;
  END;

  PERFORM public.respond_player_card_trade('20', v_trade_id, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles
    WHERE id = v_offer_asset AND player_id = 20
      AND card_id = '00000000-0000-0000-0000-000000000102'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles
    WHERE id = v_requested_asset AND player_id = 10
      AND card_id = '00000000-0000-0000-0000-000000000101'
  ) THEN
    RAISE EXCEPTION 'acceptance must atomically swap both collectible owners';
  END IF;
  IF (SELECT status FROM public.player_card_trade_offers WHERE id = v_trade_id) <> 'accepted' THEN
    RAISE EXCEPTION 'accepted offer status was not persisted';
  END IF;
  IF (SELECT count(*) FROM public.player_card_trade_events WHERE trade_id = v_trade_id) <> 2 THEN
    RAISE EXCEPTION 'proposal and acceptance must both be audited';
  END IF;

  SELECT id INTO v_second_offer_asset FROM public.player_card_collectibles
  WHERE player_id = 10 AND card_id = '00000000-0000-0000-0000-000000000104';
  v_trade_two := public.create_player_card_trade(
    '10', 20, v_second_offer_asset, '00000000-0000-0000-0000-000000000103'
  );
  PERFORM public.respond_player_card_trade('20', v_trade_two, false);
  IF (SELECT status FROM public.player_card_trade_offers WHERE id = v_trade_two) <> 'declined' THEN
    RAISE EXCEPTION 'recipient decline should persist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles
    WHERE id = v_second_offer_asset AND player_id = 10
  ) THEN
    RAISE EXCEPTION 'decline must not transfer ownership';
  END IF;

  v_trade_three := public.create_player_card_trade(
    '10', 20, v_second_offer_asset, '00000000-0000-0000-0000-000000000103'
  );
  PERFORM public.cancel_player_card_trade('10', v_trade_three);
  IF (SELECT status FROM public.player_card_trade_offers WHERE id = v_trade_three) <> 'cancelled' THEN
    RAISE EXCEPTION 'sender cancellation should persist';
  END IF;

  BEGIN
    PERFORM * FROM public.friend_collectible_inventory('10', 30);
    RAISE EXCEPTION 'non-friend inventory must not be visible';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_FRIEND%' THEN RAISE; END IF;
  END;

  IF has_table_privilege('anon', 'public.player_card_trade_offers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_card_trade_offers', 'SELECT')
     OR has_table_privilege('anon', 'public.player_card_trade_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.player_card_trade_events', 'SELECT') THEN
    RAISE EXCEPTION 'trade tables must not be directly readable by client roles';
  END IF;
END
$trade_test$;

ROLLBACK;
