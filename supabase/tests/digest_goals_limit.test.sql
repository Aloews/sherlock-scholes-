-- ============================================================
-- SHERLOCK SCHOLES — test: digest_weekend_goals() / digest_week_goals() limit
--
-- Covers supabase/migrations/digest_goals_limit.sql — the default p_limit
-- raised from 12 to 40.
--
-- MEASURED, NOT HYPOTHETICAL. Weekend 22-24.08.2026: LALIGA's Espanyol-Real
-- Madrid highlight alone drew 3.6M views, and five more LALIGA/Bundesliga/
-- Serie A clips from the same weekend outdrew everything else. Premier
-- League's own two clips of that weekend were real, tagged as goals by
-- looks_like_goal(), and sat in goal_clips all along — but ranked 17th and
-- 19th by views, below the old limit of 12. DigestScreen's league chips are
-- built from this SAME list (see the `leagues` useMemo in DigestScreen.tsx),
-- so Premier League did not just fall off the visible clip list — it had no
-- filter chip either, with no way to reach its own real data.
--
-- This pins the fix at the SQL layer: a league with a real, recent goal clip
-- must survive the default call, even when another league's clips that
-- weekend are wildly more popular. Fixture views are set far above any
-- realistic YouTube count specifically so the assertions hold regardless of
-- how much real goal_clips data coexists at test time.
--
-- HOW TO RUN — Supabase SQL Editor, or:
--     psql "$DATABASE_URL" -f supabase/tests/digest_goals_limit.test.sql
--
-- SAFETY. One transaction ending in ROLLBACK: the fixture rows never survive
-- it. video_id is prefixed 'zztest-' and channel 'ZZTEST ...' so nothing here
-- can collide with a real YouTube id or a real league name.
--
-- Requires: weekend_goals.sql, week_goals.sql, digest_goals_limit.sql.
-- On success prints: `digest_goals_limit: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_starts TIMESTAMPTZ;
  v_ends   TIMESTAMPTZ;
  v_i      INT;
  v_found  BOOLEAN;
  v_count  INT;
BEGIN
  SELECT starts_at, ends_at INTO v_starts, v_ends FROM weekend_bounds() LIMIT 1;

  -- ── Голы выходных ──────────────────────────────────────────────────────
  -- Одна лига с 15 клипами намного популярнее любой настоящей строки в
  -- проде, вторая — с одним клипом чуть менее популярным, но всё ещё
  -- многократно выше любых реальных чисел (максимум, измеренный живьём, —
  -- 3.6 млн; здесь — 80-90 млн).
  FOR v_i IN 1..15 LOOP
    INSERT INTO public.goal_clips (video_id, title, channel, published_at, views)
    VALUES (
      'zztest-big-weekend-' || v_i,
      'ZZTEST BIG 1 - 0 RIVAL | HIGHLIGHTS',
      'ZZTEST Big League',
      v_starts + interval '1 hour',
      90000000 - v_i
    );
  END LOOP;

  INSERT INTO public.goal_clips (video_id, title, channel, published_at, views)
  VALUES (
    'zztest-small-weekend',
    'ZZTEST SMALL 2 - 1 RIVAL | HIGHLIGHTS',
    'ZZTEST Small League',
    v_starts + interval '1 hour',
    80000000
  );

  -- 1. Sanity check on the fixture itself: at the OLD limit (12), fifteen
  --    bigger clips from one league alone already fill every slot, so the
  --    small league's one clip must NOT survive. If this fails, the fixture
  --    is miscalibrated — it says nothing about the product code yet.
  SELECT EXISTS (
    SELECT 1 FROM public.digest_weekend_goals(12) g
     WHERE g.channel = 'ZZTEST Small League'
  ) INTO v_found;
  ASSERT v_found = false,
    'fixture is miscalibrated: the small league already survives limit=12';

  -- 2. The actual fix: the DEFAULT call (no argument) must both return more
  --    than 12 rows and include the small league's clip.
  SELECT count(*) INTO v_count FROM public.digest_weekend_goals();
  ASSERT v_count > 12,
    'digest_weekend_goals() must default to more than 12 rows, got ' || v_count;

  SELECT EXISTS (
    SELECT 1 FROM public.digest_weekend_goals() g
     WHERE g.channel = 'ZZTEST Small League'
  ) INTO v_found;
  ASSERT v_found = true,
    'a league with a real weekend goal must survive the default call even '
    || 'when another league is far more popular that weekend — it did not';

  -- ── Лучшее за неделю мимо выходных ─────────────────────────────────────
  -- Тот же барьер, другое окно: published_at чуть ПОСЛЕ конца выходных —
  -- гарантированно внутри семидневного окна digest_week_goals() и
  -- гарантированно вне [starts_at, ends_at), которое оно же исключает.
  FOR v_i IN 1..15 LOOP
    INSERT INTO public.goal_clips (video_id, title, channel, published_at, views)
    VALUES (
      'zztest-big-week-' || v_i,
      'ZZTEST BIG MIDWEEK HIGHLIGHTS',
      'ZZTEST Big League',
      v_ends + interval '1 hour',
      90000000 - v_i
    );
  END LOOP;

  INSERT INTO public.goal_clips (video_id, title, channel, published_at, views)
  VALUES (
    'zztest-small-week',
    'ZZTEST SMALL MIDWEEK HIGHLIGHTS',
    'ZZTEST Small League',
    v_ends + interval '1 hour',
    80000000
  );

  SELECT EXISTS (
    SELECT 1 FROM public.digest_week_goals(12) g
     WHERE g.channel = 'ZZTEST Small League'
  ) INTO v_found;
  ASSERT v_found = false,
    'fixture is miscalibrated: the small league already survives digest_week_goals(12)';

  SELECT count(*) INTO v_count FROM public.digest_week_goals();
  ASSERT v_count > 12,
    'digest_week_goals() must default to more than 12 rows, got ' || v_count;

  SELECT EXISTS (
    SELECT 1 FROM public.digest_week_goals() g
     WHERE g.channel = 'ZZTEST Small League'
  ) INTO v_found;
  ASSERT v_found = true,
    'a league with a real midweek goal must survive the default digest_week_goals() call too';
END
$test$;

SELECT 'digest_goals_limit: all assertions passed' AS result;

ROLLBACK;
