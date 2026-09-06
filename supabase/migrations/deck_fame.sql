-- ============================================================
-- SHERLOCK SCHOLES — Migration: ONE fame axis (cards.fame)
--
-- Before this migration "how well-known is a card" was expressed five
-- different ways, and they contradicted each other:
--
--   * cards.pageviews          ru-wiki only -> Russian-culture bias, patched
--                              at query time by p_boost_countries
--   * cards.pageviews_i18n     8 more languages, used ONLY inside the
--                              onboarding difficulty clause
--   * cards.tier              "recognizability" chips in the picker — but
--                              INVERTED against pageviews (median views:
--                              rare 1106 < common 3143; legendary started
--                              at 17 views)
--   * cards.tags = 'star'      a 54-card hand-picked fame list
--   * cards.difficulty         dead column ('medium' on all 3364 rows)
--
-- Now there is exactly one: cards.fame, 0..100, the percentile rank of a
-- card inside its own family (players ranked against players, everything
-- else against everything else) by the metric
--
--     max(pageviews_ru, pageviews_i18n over all 8 languages)
--
-- Taking the MAX across languages — instead of ru only — is also what
-- retires p_boost_countries: a Korean or Mexican hero now ranks on his own
-- language Wikipedia, so no per-language relief hack is needed.
--
-- Everything else fame-shaped becomes a DERIVATIVE of this column:
--   * tier          cosmetic card frames, recomputed from fame
--   * tags 'legend' the Pro "Легенды" preset, recomputed from fame
--   * tags 'star'   REMOVED — it is now just `fame >= 90`
--   * the onboarding difficulty floor is a fame floor (see
--     src/features/game/onboarding.ts), not a pageviews floor
--
-- Cards with no pageviews data at all get fame = NULL (unknown), which the
-- deck predicate treats as "never famous": they appear only when no fame
-- floor is set. Guessing a fame for them would be a lie.
--
-- Idempotent: rerun refresh_card_fame() after every data import.
--
-- ⚠️ ЭТОТ ФАЙЛ БОЛЬШЕ НЕ ИСТОЧНИК ПРАВДЫ ДЛЯ refresh_card_fame().
-- Действующее определение живёт в supabase/migrations/deck_fame_home_world.sql:
-- там к оси `fame` добавлены `fame_world` (сумма по всем языкам) и
-- `fame_home` (максимум среди языков страны игрока), и там же починено окно
-- перцентиля — карточка без просмотров в него больше не входит.
-- Применить ЭТОТ файл поверх значит молча откатить прод на две колонки
-- назад. Так этот проект уже терял четыре колонки в club_profile.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS fame smallint;

COMMENT ON COLUMN cards.fame IS
  'Recognizability, 0..100 percentile within family (player / non-player), '
  'from max(pageviews, pageviews_i18n). NULL = no data. Set by refresh_card_fame().';

-- Fame bucket thresholds, in ONE place. The picker''s three steps and the
-- cosmetic tiers both read these, so a card can never be "легендарная" on the
-- frame and "малоизвестная" in the filter at the same time.
--   90+  знаменитые  (top decile)
--   60+  средние
--   0+   любые
CREATE OR REPLACE FUNCTION public.fame_tier(p_fame smallint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_fame IS NULL THEN 'common'
    WHEN p_fame >= 99 THEN 'legendary'
    WHEN p_fame >= 95 THEN 'epic'
    WHEN p_fame >= 75 THEN 'rare'
    ELSE 'common'
  END;
$$;

-- Recompute fame + everything derived from it. Run after any pageviews
-- refresh; the percentile is relative, so new cards shift the scale.
CREATE OR REPLACE FUNCTION public.refresh_card_fame()
RETURNS TABLE (family text, n_cards bigint, no_data bigint)
LANGUAGE plpgsql AS $$
BEGIN
  WITH metric AS (
    SELECT
      c.id,
      CASE WHEN c.category = 'player' THEN 'player' ELSE 'other' END AS fam,
      GREATEST(
        COALESCE(c.pageviews, 0),
        COALESCE((SELECT max(v::bigint)
                  FROM jsonb_each_text(COALESCE(c.pageviews_i18n, '{}'::jsonb)) AS e(k, v)), 0)
      ) AS views
    FROM cards c
    WHERE c.active
  ), ranked AS (
    SELECT id,
           CASE WHEN views = 0 THEN NULL
                ELSE round(100 * percent_rank() OVER (PARTITION BY fam ORDER BY views))::smallint
           END AS fame
    FROM metric
  )
  UPDATE cards c SET fame = r.fame
  FROM ranked r WHERE r.id = c.id AND c.fame IS DISTINCT FROM r.fame;

  -- Inactive cards keep no fame — they are never dealt.
  UPDATE cards SET fame = NULL WHERE NOT active AND fame IS NOT NULL;

  -- Cosmetic rarity frames follow the same axis.
  UPDATE cards c SET tier = fame_tier(c.fame)
  WHERE c.tier IS DISTINCT FROM fame_tier(c.fame);

  -- 'star' is gone: it was a second fame list. 'legend' (the Pro preset) is
  -- now exactly the top of the fame axis, so the lock and the label agree.
  UPDATE cards
     SET tags = (SELECT array_agg(t) FROM unnest(tags) t WHERE t <> 'star')
   WHERE tags && ARRAY['star'];

  UPDATE cards
     SET tags = (SELECT array_agg(t) FROM unnest(tags) t WHERE t <> 'legend')
   WHERE tags && ARRAY['legend'] AND (fame IS NULL OR fame < 99 OR category <> 'player');

  UPDATE cards
     SET tags = array_append(COALESCE(tags, '{}'), 'legend')
   WHERE category = 'player' AND fame >= 99 AND NOT COALESCE(tags, '{}') && ARRAY['legend'];

  RETURN QUERY
    SELECT CASE WHEN c.category = 'player' THEN 'player' ELSE 'other' END,
           count(*), count(*) FILTER (WHERE c.fame IS NULL)
    FROM cards c WHERE c.active GROUP BY 1;
END;
$$;

-- The deck predicate filters on (active, fame) constantly.
CREATE INDEX IF NOT EXISTS cards_active_fame_idx ON cards (active, fame)
  WHERE active;

SELECT * FROM refresh_card_fame();

NOTIFY pgrst, 'reload schema';
