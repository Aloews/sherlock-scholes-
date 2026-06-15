-- ============================================================
-- SHERLOCK SCHOLES — backfill the pro-only 'legend' tag
--
-- The Pro chip "Легенды" filters cards.tags && ['legend'], but that tag was
-- never populated (0 cards) — a pro-only category can't ship empty. This loads
-- it. The deck enforces 'legend' as Pro-only via pro_deck.sql.
--
-- ⚠️ DEFINITION MATTERS — counts (active players):
--     tier='legendary'                       ->  66   (strictest)
--   * tier IN ('legendary','epic')           -> 197   (ACTIVE below — elite, recommended)
--     tier='legendary' OR legend_career NULL -> 983   (too broad: legend_career is the
--                                                       veteran-career snapshot for ~962
--                                                       players, not "legends")
--
-- Pick ONE WHERE branch. Idempotent: re-running adds 'legend' only where
-- missing. Run in the Supabase SQL Editor.
-- ============================================================

update cards c
set tags = (
  select array(
    select distinct e
    from unnest(coalesce(c.tags, '{}'::text[]) || array['legend']) e
  )
)
where c.category = 'player'
  and c.active = true
  and not ('legend' = any(coalesce(c.tags, '{}'::text[])))
  -- RECOMMENDED — elite tiers only (~197):
  and c.tier in ('legendary', 'epic');
  -- ── alternatives (replace the line above) ──
  -- strictest (~66):
  --   and c.tier = 'legendary';
  -- broadest, as originally specced (~983 — includes all veterans w/ career):
  --   and (c.tier = 'legendary' or c.legend_career is not null);

-- VERIFY:
--   select count(*) from cards
--   where active and category='player' and 'legend' = any(tags);
