-- ============================================================
-- SHERLOCK SCHOLES — backfill the composite 'star' tag
--
-- The quick-game preset "Звёзды" filters cards.tags && ['star'], but the
-- 'star' tag was never populated (the composite-fame threshold was deferred),
-- so the preset returned 0 cards. This loads it.
--
-- star := high pageviews OR has a title OR tier legendary/epic.
-- "Played at WC/Euro" is deliberately EXCLUDED: it matched ~1156 players and
-- bloated stars to ~50% — playing at a World Cup ≠ a star. Without it the set
-- is the genuinely well-known players. (No sitelinks signal — not collected.)
-- Idempotent: re-running adds 'star' only where missing. Projected: ~345 of
-- 2600 active player cards.
-- Run in the Supabase SQL Editor.
-- ============================================================

update cards c
set tags = (
  select array(
    select distinct e
    from unnest(coalesce(c.tags, '{}'::text[]) || array['star']) e
  )
)
where c.category = 'player'
  and c.active = true
  and not ('star' = any(coalesce(c.tags, '{}'::text[])))
  and (
        coalesce(c.pageviews, 0) >= 19000
        or (jsonb_typeof(c.facts->'titles') = 'array'
            and jsonb_array_length(c.facts->'titles') > 0)
        or (jsonb_typeof(c.legend_career->'titles') = 'array'
            and jsonb_array_length(c.legend_career->'titles') > 0)
        or c.tier in ('legendary', 'epic')
      );

-- VERIFY — how many stars now:
--   select count(*) from cards
--   where active and category='player' and 'star' = any(tags);
