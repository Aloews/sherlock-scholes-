-- ============================================================
-- SHERLOCK SCHOLES — test: player_ratings() / player_collected_totals()
--
-- Covers supabase/migrations/player_match_stats.sql — the collapse of two
-- SOURCES down to one MATCH before anything is summed.
--
-- WHAT IS BEING PINNED, and why it is not obvious from the schema. The
-- primary key is (card_id, match_date, tournament), and `tournament` is
-- written in the vocabulary of whichever source produced the row: sports.ru
-- prints «США. МЛС», ESPN puts `header.league.name`, i.e. "MLS". Those two
-- strings do not collide, so one real match sits in the table as TWO rows —
-- deliberately, because two independent records of the same match are the
-- only thing that catches a silent parser break (a column shift on sports.ru
-- once produced 62 goals where the page said 59, and both numbers looked
-- plausible).
--
-- The cost of keeping both rows is that NAIVE ARITHMETIC OVER THIS TABLE
-- LIES: `sum(goals)` counts one goal twice and `count(*)` reports "2 matches"
-- for one played. Measured against production data before ESPN's first run,
-- the error was an exact doubling for every player — Mbappé came out with 60
-- points instead of 30 and 10 matches instead of 5.
--
-- That is the failure this file exists to stop coming back, and it is worth a
-- test precisely BECAUSE it is invisible on screen: a doubled rating looks
-- exactly as believable as a real one. Nothing about the number tells you it
-- is wrong, so only an assertion can.
--
-- Case 1 fails without the `distinct on` in `player_ratings`.
-- Case 2 pins WHICH of the two rows wins: the one that knows more. Minutes
--   exist on sports.ru and do not exist on ESPN, and the rating breaks ties
--   by "fewer minutes for the same return" — so a collapse that kept the
--   minute-less row would hand that tie-break to a row that cannot have
--   earned it.
-- Case 3 fails if someone collapses by card_id alone: two matches on two
--   different days are two matches, and over-collapsing would erase a real
--   week of football just as thoroughly as double-counting inflated it.
-- Case 4 is the same collapse in the dossier, where the symptom is different:
--   the tournament breakdown splits one match across «США. МЛС» and "MLS",
--   and a reader cannot add those together.
--
-- HOW TO RUN — Supabase SQL Editor, or:
--     psql "$DATABASE_URL" -f supabase/tests/player_ratings_dedup.test.sql
--
-- SAFETY. One transaction ending in ROLLBACK: the fixture card and its stat
-- rows never survive it. The fixture is named with a 'ZZTESTRAT' prefix and
-- every assertion is scoped to the fixture's own card_id, so the result never
-- depends on what the real table happens to hold.
--
-- Requires: player_match_stats.sql.
-- On success prints one row: `player_ratings dedup: all assertions passed`.
-- On failure the transaction aborts with the failing ASSERT message.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_card    UUID;
  v_matches INTEGER;
  v_minutes INTEGER;
  v_goals   INTEGER;
  v_assists INTEGER;
  v_points  INTEGER;
  v_rows    INTEGER;
  v_tour    TEXT;
BEGIN
  INSERT INTO public.cards (name, name_en, category, active)
  VALUES ('ZZTESTRAT Игрок', 'ZZTESTRAT Player', 'player', true)
  RETURNING id INTO v_card;

  -- ---------------------------------------------------------------
  -- One match, both sources. This is exactly what the nightly run
  -- produces: the sports.ru step writes first, the ESPN step second, and
  -- neither knows about the other.
  --
  -- The two rows agree about the football (1 goal, 1 assist) and disagree
  -- only about what the competition is called and whether minutes are
  -- known — which is the real shape of the disagreement, not a contrived
  -- one.
  -- ---------------------------------------------------------------
  INSERT INTO public.player_match_stats
    (card_id, match_date, tournament, minutes, goals, assists, source) VALUES
    (v_card, current_date - 1, 'США. МЛС', 90,   1, 1, 'sports.ru'),
    (v_card, current_date - 1, 'MLS',      NULL, 1, 1, 'espn');

  -- 1. The rating counts the match once. `p_limit` is the maximum the
  --    function allows so the fixture is present whatever it scores — this
  --    asserts the arithmetic, not the leaderboard position.
  SELECT r.matches, r.minutes, r.goals, r.assists, r.points
    INTO v_matches, v_minutes, v_goals, v_assists, v_points
    FROM public.player_ratings(7, 200) r
   WHERE r.card_id = v_card;

  ASSERT v_matches IS NOT NULL,
    'the fixture player must appear in the rating at all';
  ASSERT v_matches = 1,
    'one match reported by two sources is ONE match, got ' || v_matches;
  ASSERT v_goals = 1,
    'one goal reported by two sources is ONE goal, got ' || v_goals;
  ASSERT v_assists = 1,
    'one assist reported by two sources is ONE assist, got ' || v_assists;
  ASSERT v_points = 7,
    'points are goals*4 + assists*3 over the collapsed match, got ' || v_points;

  -- 2. The surviving row is the one carrying minutes. Summing both rows
  --    would also print 90 here (Postgres sums across NULL), so this only
  --    means something next to case 1 — together they say "one row, and the
  --    richer one".
  ASSERT v_minutes = 90,
    'the row WITH minutes must win the collapse, got ' || coalesce(v_minutes::text, 'NULL');

  -- 3. Two different days are two matches. The collapse key is
  --    (card_id, match_date), never card_id alone.
  INSERT INTO public.player_match_stats
    (card_id, match_date, tournament, minutes, goals, assists, source) VALUES
    (v_card, current_date - 2, 'США. МЛС', 90, 1, 0, 'sports.ru');

  SELECT r.matches, r.goals INTO v_matches, v_goals
    FROM public.player_ratings(7, 200) r
   WHERE r.card_id = v_card;

  ASSERT v_matches = 2,
    'two matches on two days must stay two, got ' || v_matches;
  ASSERT v_goals = 2,
    'a goal on each of two days is two goals, got ' || v_goals;

  -- 4. The dossier: one tournament line, not one per source vocabulary.
  SELECT count(*)::integer INTO v_rows
    FROM public.player_collected_totals(v_card);
  ASSERT v_rows = 1,
    'the dossier must not split one match across «США. МЛС» and "MLS", got '
      || v_rows || ' tournament rows';

  SELECT t.tournament, t.matches INTO v_tour, v_matches
    FROM public.player_collected_totals(v_card) t;
  ASSERT v_tour = 'США. МЛС',
    'the surviving tournament name comes from the source that won the collapse, got ' || v_tour;
  ASSERT v_matches = 2,
    'the dossier counts collapsed matches too, got ' || v_matches;
END
$test$;

SELECT 'player_ratings dedup: all assertions passed' AS result;

ROLLBACK;
