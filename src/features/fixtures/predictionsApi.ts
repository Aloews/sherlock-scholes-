// Predicting a score, and reading back what it was worth.
//
// The player says what they think the score will be; after the match they find
// out. Deliberately NOT a bookmaker's prediction — §4 of
// docs/LIVE_FOOTBALL_HANDOFF.md keeps prices and everything derived from them
// off screen, and this client could not read them anyway.
//
// Both calls carry signed initData: a client must not be able to predict on
// somebody else's behalf, and `match_predictions` has no grant at all, so
// there is no direct read either.

import { supabase } from '@/shared/lib/supabase';

export interface Prediction {
  fixture_id: string;
  home_score: number;
  away_score: number;
  /** Null until the match is over and settlement has run. Not zero — "not
   *  checked yet" and "you got nothing" are different answers. */
  points: number | null;
  settled_at: string | null;
}

/** What the ladder pays, for showing the rule without reading SQL. */
export const PREDICTION_POINTS = { exact: 5, difference: 3, outcome: 2 } as const;

export async function fetchMyPredictions(initData: string): Promise<Prediction[]> {
  if (!initData) return [];
  const { data, error } = await supabase.rpc('my_predictions', { p_init_data: initData });
  if (error) {
    console.error('[predictions] my_predictions failed:', error.code, error.message);
    return [];
  }
  return (data as Prediction[]) ?? [];
}

/**
 * Predict a score.
 *
 * False is a real answer, not only a transport failure: the server refuses a
 * match that has already kicked off, and it decides that with its own clock.
 * The caller must show the refusal rather than a tick.
 */
export async function predictMatch(
  initData: string,
  fixtureId: string,
  home: number,
  away: number,
): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('predict_match', {
    p_init_data: initData,
    p_fixture_id: fixtureId,
    p_home: home,
    p_away: away,
  });
  if (error) {
    console.error('[predictions] predict_match failed:', error.code, error.message);
    return false;
  }
  return data === true;
}

/** Everything settled so far, added up. The number a profile would show. */
export function totalPoints(predictions: Prediction[]): number {
  return predictions.reduce((sum, p) => sum + (p.points ?? 0), 0);
}
