-- ============================================================
-- SHERLOCK SCHOLES — Migration: cards.top_league holds LEAGUES only
--
-- top_league is filled from the API-Football cache, which names the
-- competition of the player's best season — and that competition is often
-- not a league at all. Before this migration 192 of 1367 non-null values
-- were cups or friendlies:
--
--   Friendlies Clubs 58 · Cup 44 · First League 22 · League Cup 15 ·
--   UEFA Europa League 12 · Europa Conference 12 · FA Cup 11 ·
--   Coppa Italia 4 · Super Cup 3 · PL Summer Series 3 · DFB Pokal 2 ·
--   UEFA Champions League 2 · Copa del Rey 2 · Coupe de France 1 ·
--   UEFA-CONMEBOL Club Challenge 1
--
-- Worse, the biggest bucket was a homonym: "Premier League" (723 players)
-- lumped ENGLAND together with RUSSIA (~258 players: Спартак, Зенит, ЦСКА,
-- Ахмат, Крылья Советов…) and BELARUS (Динамо (Брест), 17). A player
-- picking "Premier League" expecting Salah could get a Fakel reserve.
--
-- This migration:
--   1. splits the homonym by club — Russian clubs -> 'Russian Premier
--      League', the Belarusian club -> NULL (not a top-5 league we offer);
--   2. rebuilds cup/friendly rows from the player's own club: 169 of 192
--      resolve because the same club appears with a real league on other
--      players;
--   3. NULLs whatever is still not a league.
--
-- deck_leagues() is the single source of truth for the picker's league
-- list — the UI no longer derives options from live data (which is how the
-- cups reached the dropdown in the first place).
-- ============================================================

-- ── The offered leagues, in display order ────────────────────────────
CREATE OR REPLACE FUNCTION public.deck_leagues()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'Premier League',
    'La Liga',
    'Serie A',
    'Bundesliga',
    'Ligue 1',
    'Eredivisie',
    'Russian Premier League'
  ]::text[];
$$;

-- ── 1. Split the "Premier League" homonym ────────────────────────────
-- Russian top-flight clubs as they appear in cards.top_club (the source
-- mixes Latin and Cyrillic spellings). Сочи and Урал currently sit in the
-- Russian First League (second tier) after relegation; they are kept as
-- RPL clubs because that is the competition the cards were built from.
CREATE OR REPLACE FUNCTION public.rpl_clubs()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'Zenit', 'Spartak Moscow', 'Lokomotiv', 'FC Krasnodar', 'Akron',
    'Fakel', 'Nizhny Novgorod', 'Dinamo Makhachkala',
    'ЦСКА (Москва)', 'Ахмат', 'Рубин', 'Крылья Советов', 'Химки',
    'Ростов', 'Оренбург', 'Урал', 'Сочи'
  ]::text[];
$$;

UPDATE cards
   SET top_league = 'Russian Premier League'
 WHERE category = 'player'
   AND top_club = ANY(rpl_clubs())
   AND top_league IS DISTINCT FROM 'Russian Premier League';

-- Belarusian "Premier League" — a third homonym, and the only club of it
-- in the deck. No filter entry for it, so the league is simply unknown.
UPDATE cards
   SET top_league = NULL
 WHERE category = 'player' AND top_club = 'Динамо (Брест)';

-- ── 2. Rebuild cups/friendlies from the player's club ────────────────
-- For every club, the league its OTHER cards agree on (majority wins).
WITH club_league AS (
  SELECT top_club, top_league,
         row_number() OVER (PARTITION BY top_club ORDER BY count(*) DESC, top_league) AS rn
    FROM cards
   WHERE active AND category = 'player'
     AND top_club IS NOT NULL
     AND top_league = ANY(deck_leagues())
   GROUP BY top_club, top_league
)
UPDATE cards c
   SET top_league = cl.top_league
  FROM club_league cl
 WHERE cl.rn = 1
   AND cl.top_club = c.top_club
   AND c.category = 'player'
   AND c.top_league IS NOT NULL
   AND NOT (c.top_league = ANY(deck_leagues()));

-- ── 3. Anything still not a league is not a league ───────────────────
UPDATE cards
   SET top_league = NULL
 WHERE top_league IS NOT NULL
   AND NOT (top_league = ANY(deck_leagues()));

NOTIFY pgrst, 'reload schema';
