-- Separate the source valuation date from the last successful source check.
-- A source can return an older valuation date (or no price) even when the
-- profile fetch succeeded. We must record the check so a fixed daily batch
-- does not retry the same alphabetic/undated cards forever.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS market_value_checked_at timestamptz;

COMMENT ON COLUMN public.cards.market_value_checked_at IS
  'Last time the Transfermarkt valuation profile was checked. Separate from market_value_at, which is the source valuation date.';

CREATE OR REPLACE FUNCTION public.apply_card_market_values(p_rows jsonb)
RETURNS TABLE(written integer, seen integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_written integer;
  v_seen integer;
BEGIN
  WITH raw AS (
    SELECT
      (r->>'card_id')::uuid AS card_id,
      NULLIF(r->>'value_eur', '')::bigint AS value_eur,
      NULLIF(r->>'valued_at', '')::date AS valued_at
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
    WHERE (r->>'card_id') IS NOT NULL
  ),
  src AS MATERIALIZED (
    SELECT
      r.card_id,
      r.value_eur,
      r.valued_at,
      c.market_value_eur AS old_value,
      c.market_value_at AS old_at,
      (
        r.value_eur > 0
        AND r.valued_at IS NOT NULL
        AND r.valued_at <= current_date
        AND (c.market_value_at IS NULL OR r.valued_at >= c.market_value_at)
        AND (
          c.market_value_eur IS DISTINCT FROM r.value_eur
          OR c.market_value_at IS DISTINCT FROM r.valued_at
        )
      ) AS price_changed
    FROM raw r
    JOIN public.cards c ON c.id = r.card_id
  ),
  upd AS (
    UPDATE public.cards c
       SET market_value_eur = CASE
             WHEN s.value_eur > 0
              AND s.valued_at IS NOT NULL
              AND s.valued_at <= current_date
              AND (c.market_value_at IS NULL OR s.valued_at >= c.market_value_at)
             THEN s.value_eur ELSE c.market_value_eur END,
           market_value_at = CASE
             WHEN s.value_eur > 0
              AND s.valued_at IS NOT NULL
              AND s.valued_at <= current_date
              AND (c.market_value_at IS NULL OR s.valued_at >= c.market_value_at)
             THEN s.valued_at ELSE c.market_value_at END,
           market_value_checked_at = now()
      FROM src s
     WHERE c.id = s.card_id
    RETURNING c.id
  )
  SELECT
    COUNT(*) FILTER (WHERE s.price_changed)::integer,
    COUNT(*)::integer
  INTO v_written, v_seen
  FROM src s
  CROSS JOIN (SELECT COUNT(*) FROM upd) completed;

  RETURN QUERY SELECT COALESCE(v_written, 0), COALESCE(v_seen, 0);
END;
$$;

NOTIFY pgrst, 'reload schema';
