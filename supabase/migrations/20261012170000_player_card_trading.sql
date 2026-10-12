-- Secure player-to-player collectible card trades.
-- A proposal is a one-for-one swap; the recipient must explicitly accept.
-- Ownership is transferred only in a single database transaction.
BEGIN;

CREATE TABLE IF NOT EXISTS public.player_card_trade_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_player_id bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  to_player_id bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  offered_collectible_id uuid NOT NULL REFERENCES public.player_card_collectibles(id) ON DELETE RESTRICT,
  requested_card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  CONSTRAINT player_card_trade_not_self CHECK (from_player_id <> to_player_id)
);

CREATE TABLE IF NOT EXISTS public.player_card_trade_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id uuid NOT NULL REFERENCES public.player_card_trade_offers(id) ON DELETE CASCADE,
  actor_player_id bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('proposed', 'accepted', 'declined', 'cancelled', 'expired')),
  offered_card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  requested_card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS player_card_trade_one_pending_offer_per_asset
  ON public.player_card_trade_offers (offered_collectible_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS player_card_trade_one_pending_request_per_card
  ON public.player_card_trade_offers (to_player_id, requested_card_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS player_card_trade_inbox_idx
  ON public.player_card_trade_offers (to_player_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS player_card_trade_outbox_idx
  ON public.player_card_trade_offers (from_player_id, status, created_at DESC);

ALTER TABLE public.player_card_trade_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_card_trade_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_card_trade_offers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_card_trade_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_card_tradeable_collectibles(p_init_data text)
RETURNS TABLE (
  collectible_id uuid,
  card_id uuid,
  name text,
  name_en text,
  category text,
  category_ru text,
  photo_url text,
  tier text
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
  SELECT i.id, c.id, c.name, c.name_en, c.category, c.category_ru, c.photo_url, c.tier
  FROM public.player_card_collectibles i
  JOIN public.cards c ON c.id = i.card_id
  WHERE i.player_id = v_me
  ORDER BY i.acquired_at DESC, c.name;
END;
$function$;
CREATE OR REPLACE FUNCTION public.friend_collectible_inventory(
  p_init_data text,
  p_friend_id bigint
)
RETURNS TABLE (
  card_id uuid,
  name text,
  name_en text,
  category text,
  category_ru text,
  photo_url text,
  tier text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL OR p_friend_id IS NULL OR p_friend_id = v_me THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.player_id = v_me AND f.friend_id = p_friend_id
  ) THEN
    RAISE EXCEPTION 'NOT_FRIEND';
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.name_en, c.category, c.category_ru, c.photo_url, c.tier
  FROM public.player_card_collectibles i
  JOIN public.cards c ON c.id = i.card_id
  WHERE i.player_id = p_friend_id
  ORDER BY i.acquired_at DESC, c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_player_card_trade(
  p_init_data text,
  p_to_player_id bigint,
  p_offered_collectible_id uuid,
  p_requested_card_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
  v_offered_card_id uuid;
  v_trade_id uuid;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL OR p_to_player_id IS NULL OR p_to_player_id = v_me THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.player_id = v_me AND f.friend_id = p_to_player_id
  ) THEN
    RAISE EXCEPTION 'NOT_FRIEND';
  END IF;

  SELECT i.card_id INTO v_offered_card_id
  FROM public.player_card_collectibles i
  WHERE i.id = p_offered_collectible_id AND i.player_id = v_me
  FOR UPDATE;
  IF v_offered_card_id IS NULL THEN
    RAISE EXCEPTION 'OFFERED_CARD_NOT_OWNED';
  END IF;

  IF p_requested_card_id = v_offered_card_id THEN
    RAISE EXCEPTION 'SAME_CARD';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.player_id = p_to_player_id AND i.card_id = p_requested_card_id
  ) THEN
    RAISE EXCEPTION 'REQUESTED_CARD_NOT_OWNED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.player_id = p_to_player_id AND i.card_id = v_offered_card_id
  ) OR EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.player_id = v_me AND i.card_id = p_requested_card_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_CARD';
  END IF;

  INSERT INTO public.player_card_trade_offers
    (from_player_id, to_player_id, offered_collectible_id, requested_card_id)
  VALUES (v_me, p_to_player_id, p_offered_collectible_id, p_requested_card_id)
  RETURNING id INTO v_trade_id;

  INSERT INTO public.player_card_trade_events
    (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
  VALUES (v_trade_id, v_me, 'proposed', v_offered_card_id, p_requested_card_id);

  RETURN v_trade_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_player_card_trades(p_init_data text)
RETURNS TABLE (
  trade_id uuid,
  direction text,
  other_player_id bigint,
  other_player_name text,
  offered_card_id uuid,
  offered_card_name text,
  offered_card_name_en text,
  offered_photo_url text,
  offered_tier text,
  requested_card_id uuid,
  requested_card_name text,
  requested_card_name_en text,
  requested_photo_url text,
  requested_tier text,
  status text,
  created_at timestamptz,
  expires_at timestamptz
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

  INSERT INTO public.player_card_trade_events
    (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
  SELECT t.id, v_me, 'expired', owned.card_id, t.requested_card_id
  FROM public.player_card_trade_offers t
  JOIN public.player_card_collectibles owned ON owned.id = t.offered_collectible_id
  WHERE t.status = 'pending' AND t.expires_at <= now()
    AND (t.from_player_id = v_me OR t.to_player_id = v_me);

  UPDATE public.player_card_trade_offers t
  SET status = 'expired', responded_at = now()
  WHERE t.status = 'pending' AND t.expires_at <= now()
    AND (t.from_player_id = v_me OR t.to_player_id = v_me);

  RETURN QUERY
  SELECT t.id,
         CASE WHEN t.to_player_id = v_me THEN 'incoming' ELSE 'outgoing' END,
         CASE WHEN t.to_player_id = v_me THEN t.from_player_id ELSE t.to_player_id END,
         trim(concat_ws(' ', other.first_name, other.last_name)),
         offered.id, offered.name, offered.name_en, offered.photo_url, offered.tier,
         requested.id, requested.name, requested.name_en, requested.photo_url, requested.tier,
         t.status, t.created_at, t.expires_at
  FROM public.player_card_trade_offers t
  JOIN public.players other
    ON other.id = CASE WHEN t.to_player_id = v_me THEN t.from_player_id ELSE t.to_player_id END
  JOIN public.player_card_collectibles owned_offer ON owned_offer.id = t.offered_collectible_id
  JOIN public.cards offered ON offered.id = owned_offer.card_id
  JOIN public.cards requested ON requested.id = t.requested_card_id
  WHERE (t.from_player_id = v_me OR t.to_player_id = v_me)
    AND (t.status = 'pending' OR t.responded_at >= now() - interval '30 days')
  ORDER BY (t.status = 'pending') DESC, t.created_at DESC
  LIMIT 50;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_player_card_trade(
  p_init_data text,
  p_trade_id uuid,
  p_accept boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
  v_trade public.player_card_trade_offers%ROWTYPE;
  v_offered_card_id uuid;
  v_requested_collectible_id uuid;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_trade
  FROM public.player_card_trade_offers
  WHERE id = p_trade_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRADE_NOT_FOUND';
  END IF;
  IF v_trade.to_player_id <> v_me THEN
    RAISE EXCEPTION 'NOT_TRADE_RECIPIENT';
  END IF;
  IF v_trade.status <> 'pending' THEN
    RAISE EXCEPTION 'TRADE_NOT_PENDING';
  END IF;
  IF v_trade.expires_at <= now() THEN
    SELECT i.card_id INTO v_offered_card_id
    FROM public.player_card_collectibles i
    WHERE i.id = v_trade.offered_collectible_id;
    IF v_offered_card_id IS NOT NULL THEN
      INSERT INTO public.player_card_trade_events
        (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
      VALUES (v_trade.id, v_me, 'expired', v_offered_card_id, v_trade.requested_card_id);
    END IF;
    UPDATE public.player_card_trade_offers
    SET status = 'expired', responded_at = now()
    WHERE id = v_trade.id;
    RETURN false;
  END IF;

  SELECT i.card_id INTO v_offered_card_id
  FROM public.player_card_collectibles i
  WHERE i.id = v_trade.offered_collectible_id;
  IF v_offered_card_id IS NULL THEN
    RAISE EXCEPTION 'OFFERED_CARD_NOT_FOUND';
  END IF;

  -- A decline is always allowed for the recipient and never moves assets.
  IF NOT p_accept THEN
    UPDATE public.player_card_trade_offers
    SET status = 'declined', responded_at = now()
    WHERE id = v_trade.id;
    INSERT INTO public.player_card_trade_events
      (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
    VALUES (v_trade.id, v_me, 'declined', v_offered_card_id, v_trade.requested_card_id);
    RETURN true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.id = v_trade.offered_collectible_id AND i.player_id = v_trade.from_player_id
  ) THEN
    RAISE EXCEPTION 'OFFERED_CARD_NOT_OWNED';
  END IF;

  SELECT i.id INTO v_requested_collectible_id
  FROM public.player_card_collectibles i
  WHERE i.player_id = v_trade.to_player_id AND i.card_id = v_trade.requested_card_id;
  IF v_requested_collectible_id IS NULL THEN
    RAISE EXCEPTION 'REQUESTED_CARD_NOT_OWNED';
  END IF;

  -- Lock both collectible instances in deterministic order before ownership changes.
  PERFORM i.id
  FROM public.player_card_collectibles i
  WHERE i.id IN (v_trade.offered_collectible_id, v_requested_collectible_id)
  ORDER BY i.id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.id = v_trade.offered_collectible_id
      AND i.player_id = v_trade.from_player_id AND i.card_id = v_offered_card_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.id = v_requested_collectible_id
      AND i.player_id = v_trade.to_player_id AND i.card_id = v_trade.requested_card_id
  ) THEN
    RAISE EXCEPTION 'TRADE_OWNERSHIP_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.player_id = v_trade.to_player_id AND i.card_id = v_offered_card_id
  ) OR EXISTS (
    SELECT 1 FROM public.player_card_collectibles i
    WHERE i.player_id = v_trade.from_player_id AND i.card_id = v_trade.requested_card_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_CARD';
  END IF;

  UPDATE public.player_card_collectibles
  SET player_id = v_trade.to_player_id, acquired_via = 'trade', acquired_at = now()
  WHERE id = v_trade.offered_collectible_id;

  UPDATE public.player_card_collectibles
  SET player_id = v_trade.from_player_id, acquired_via = 'trade', acquired_at = now()
  WHERE id = v_requested_collectible_id;

  UPDATE public.player_card_trade_offers
  SET status = 'accepted', responded_at = now()
  WHERE id = v_trade.id;

  INSERT INTO public.player_card_trade_events
    (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
  VALUES (v_trade.id, v_me, 'accepted', v_offered_card_id, v_trade.requested_card_id);

  RETURN true;
END;
$function$;
CREATE OR REPLACE FUNCTION public.cancel_player_card_trade(
  p_init_data text,
  p_trade_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me bigint;
  v_trade public.player_card_trade_offers%ROWTYPE;
  v_offered_card_id uuid;
BEGIN
  v_me := public.tg_validate_init_data(p_init_data);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_trade FROM public.player_card_trade_offers
  WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRADE_NOT_FOUND';
  END IF;
  IF v_trade.from_player_id <> v_me THEN
    RAISE EXCEPTION 'NOT_TRADE_SENDER';
  END IF;
  IF v_trade.status <> 'pending' THEN
    RAISE EXCEPTION 'TRADE_NOT_PENDING';
  END IF;

  SELECT i.card_id INTO v_offered_card_id
  FROM public.player_card_collectibles i
  WHERE i.id = v_trade.offered_collectible_id;
  UPDATE public.player_card_trade_offers
  SET status = 'cancelled', responded_at = now()
  WHERE id = v_trade.id;
  INSERT INTO public.player_card_trade_events
    (trade_id, actor_player_id, action, offered_card_id, requested_card_id)
  VALUES (v_trade.id, v_me, 'cancelled', v_offered_card_id, v_trade.requested_card_id);

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.my_card_tradeable_collectibles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.friend_collectible_inventory(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_player_card_trade(text, bigint, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_player_card_trades(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_player_card_trade(text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_player_card_trade(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_card_tradeable_collectibles(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.friend_collectible_inventory(text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_player_card_trade(text, bigint, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_player_card_trades(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_player_card_trade(text, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_player_card_trade(text, uuid) TO anon, authenticated;

COMMIT;
