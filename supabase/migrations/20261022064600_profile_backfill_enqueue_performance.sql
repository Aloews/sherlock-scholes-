-- Keep the missing-photo candidate set indexable during queue refill.
-- This migration is additive; it does not modify cards or existing photo fields.
CREATE INDEX IF NOT EXISTS cards_profile_backfill_missing_photo_priority_idx
  ON public.cards (market_value_eur DESC NULLS LAST, id)
  INCLUDE (transfermarkt_id, wikidata_qid)
  WHERE category = 'player'
    AND active IS TRUE
    AND NULLIF(BTRIM(photo_url), '') IS NULL;

CREATE INDEX IF NOT EXISTS soccerwiki_player_profile_backfill_photo_idx
  ON public.soccerwiki_player (card_id)
  WHERE NULLIF(BTRIM(photo_url), '') IS NOT NULL;

ANALYZE public.cards;
ANALYZE public.soccerwiki_player;
