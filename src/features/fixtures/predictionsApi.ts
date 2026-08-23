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
import { fromPostgrest, ok, type LoadState } from '@/shared/lib/loadState';

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

/**
 * Свои прогнозы — и здесь пустота ВРЁТ АКТИВНО, а не просто скрывает отказ.
 *
 * Остальные вызовы при неудаче показывали «ничего нет». Этот показывает, что
 * НИ ОДИН матч не предсказан, — то есть утверждает про игрока то, чего не
 * было. Человек видит пустые поля там, где вчера вводил счёт, и вводит его
 * заново; сервер отвечает «уже есть», и виноватым выглядит игрок.
 *
 * Вне Telegram прогнозов нет по-настоящему: это ok с пустотой, а не отказ.
 */
export async function fetchMyPredictions(initData: string): Promise<LoadState<Prediction[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('my_predictions', { p_init_data: initData });
  return fromPostgrest<Prediction[]>(res, 'my_predictions');
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

// ── Счётчик и рейтинг ──────────────────────────────────────────────────────

/** Строка таблицы лидеров. Публичная, как рейтинг друзей. */
export interface PredictorRow {
  player_id: number;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  points: number;
  settled: number;
  /** Сколько раз счёт угадан в точку. Отличает везение от чутья. */
  exact: number;
}

/** Личная сводка. `rank` равен null, когда закрытых прогнозов ещё нет —
 *  «места пока нет» и «последнее место» это разные вещи. */
export interface MyPredictionStats {
  points: number;
  settled: number;
  exact: number;
  pending: number;
  rank: number | null;
}

export async function fetchLeaderboard(limit = 20): Promise<LoadState<PredictorRow[]>> {
  const res = await supabase.rpc('prediction_leaderboard', { p_limit: limit });
  return fromPostgrest<PredictorRow[]>(res, 'prediction_leaderboard');
}

/**
 * То же самое, но вызывающий и его друзья — весь состав, даже те, кто ещё
 * ни разу не прогнозировал (friend_prediction_leaderboard.sql). Пусто вне
 * Telegram: initData нет, а без него нельзя узнать, кто твои друзья.
 */
export async function fetchFriendLeaderboard(
  initData: string,
  limit = 20,
): Promise<LoadState<PredictorRow[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('friend_prediction_leaderboard', {
    p_init_data: initData,
    p_limit: limit,
  });
  return fromPostgrest<PredictorRow[]>(res, 'friend_prediction_leaderboard');
}

export async function fetchMyStats(initData: string): Promise<MyPredictionStats | null> {
  if (!initData) return null;
  const { data, error } = await supabase.rpc('my_prediction_stats', { p_init_data: initData });
  if (error) {
    console.error('[predictions] my_prediction_stats failed:', error.code, error.message);
    return null;
  }
  // Возвращает ровно одну строку; PostgREST отдаёт её массивом.
  const rows = (data as MyPredictionStats[]) ?? [];
  return rows[0] ?? null;
}
