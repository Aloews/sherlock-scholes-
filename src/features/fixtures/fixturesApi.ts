// Upcoming matches — the client half of fixtures_and_odds.sql.
//
// The server half has been filling `fixtures` for a while; this is the part
// that was never written. Reads go straight through PostgREST because
// `fixtures` is public to read by policy AND by grant (both, deliberately —
// see current_squads.sql for what happens when only one is written).
//
// WHAT IS NOT HERE, AND WILL NOT BE. `fixture_odds` has no policy and no grant,
// so this cannot read bookmaker prices even by accident, and nothing derived
// from them may reach a screen — "favourite" is the odd restated. That was
// decided in §4 of docs/LIVE_FOOTBALL_HANDOFF.md and the schema enforces it
// rather than trusting this file to remember.

import { supabase } from '@/shared/lib/supabase';

export interface Fixture {
  id: string;
  sport_key: string;
  commence_at: string;
  home_team: string;
  away_team: string;
  /** Our card for the club, when its name could be matched. Usually null:
   *  fewer than half the clubs in these competitions are cards. */
  home_card_id: string | null;
  away_card_id: string | null;
  home_score: number | null;
  away_score: number | null;
  completed: boolean;
  /** When the score was last refreshed. The UI must render the AGE of this,
   *  never the score alone — a stale score shown as current is a lie. */
  scores_at: string | null;
}

/** How many matches a screen asks for. Two weeks of football is plenty. */
export const UPCOMING_LIMIT = 60;

/**
 * The next matches, soonest first.
 *
 * `commence_at > now()` is evaluated by Postgres rather than by the device:
 * a phone with a wrong clock would otherwise hide today's football or show
 * yesterday's.
 */
export async function fetchUpcomingFixtures(limit = UPCOMING_LIMIT): Promise<Fixture[]> {
  const { data, error } = await supabase
    .from('fixtures')
    .select('id,sport_key,commence_at,home_team,away_team,home_card_id,away_card_id,home_score,away_score,completed,scores_at')
    .gt('commence_at', new Date().toISOString())
    .order('commence_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[fixtures] upcoming failed:', error.code, error.message);
    return [];
  }
  return (data as Fixture[]) ?? [];
}

/**
 * Matches grouped by the day they kick off, in the viewer's own timezone.
 *
 * Grouped here rather than in SQL because "which day is this" depends on where
 * the viewer is standing, and the server has no idea. A 22:00 UTC kick-off is
 * tonight in Madrid and tomorrow morning in Tokyo, and both are correct.
 */
export function groupByDay(fixtures: Fixture[]): { day: string; fixtures: Fixture[] }[] {
  const days = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    const local = new Date(fixture.commence_at);
    // Local calendar date, not an ISO slice: toISOString() would re-introduce
    // UTC and put an evening match on the wrong day for half the world.
    const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    const bucket = days.get(day);
    if (bucket) bucket.push(fixture);
    else days.set(day, [fixture]);
  }
  // Insertion order is already chronological — the query sorted them.
  return [...days.entries()].map(([day, list]) => ({ day, fixtures: list }));
}
