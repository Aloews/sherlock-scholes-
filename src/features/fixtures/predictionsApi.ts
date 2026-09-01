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
  /** Сколько раз угадан ИСХОД — победа, ничья, поражение. */
  outcome_hits: number;
  /** `outcome_hits` в процентах от закрытых, уже округлённые. */
  accuracy: number;
  /**
   * ТО ЖЕ ЧИСЛО, ЧТО `outcome_hits` — колонка параллельной сессии, оставленная
   * нарочно: её читает другой клиент, и убрать её значило бы стереть у него
   * процент с экрана. История столкновения — в
   * supabase/migrations/prediction_accuracy_keep_outcome_rate.sql.
   */
  outcomes: number;
  /**
   * Процент исходов, но `null` до пяти закрытых прогнозов.
   *
   * ⚠️ ПОКАЗЫВАТЬ НАДО ЭТО, А НЕ `accuracy`. Оба числа верны, но 50% по двум
   * прогнозам — шум, а не оценка, и прочерк на его месте честнее круглого
   * числа. `accuracy` остаётся для тех мест, где прочерк рисовать негде.
   */
  outcome_rate: number | null;
  /**
   * ЧЕМ ОТСОРТИРОВАН СПИСОК. Средние очки за прогноз, стянутые к среднему по
   * полю, ×100 — «очки за сто прогнозов такого качества». Считает сервер
   * (prediction_accuracy.sql), и повторять эту арифметику здесь нельзя: две
   * копии формулы однажды разойдутся, и место в таблице перестанет
   * соответствовать числу рядом с ним.
   *
   * ⚠️ ИМЕННО ЭТО ЧИСЛО НАДО ПОКАЗЫВАТЬ В СТРОКЕ, А НЕ `points`. Список
   * упорядочен по рейтингу; нарисовать справа очки значит показать 5 над 81 и
   * выдать это за ошибку сортировки.
   */
  rating: number;
}

/** Личная сводка. `rank` равен null, когда закрытых прогнозов ещё нет —
 *  «места пока нет» и «последнее место» это разные вещи. */
export interface MyPredictionStats {
  points: number;
  settled: number;
  exact: number;
  outcome_hits: number;
  accuracy: number;
  rating: number;
  pending: number;
  rank: number | null;
  outcomes: number;
  /** Процент исходов, `null` до пяти закрытых прогнозов — см. PredictorRow. */
  outcome_rate: number | null;
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

// ── История ─────────────────────────────────────────────────────────────

/**
 * Один прогноз с именами команд и настоящим счётом — то, чего у `Prediction`
 * нет и не может быть: `fixtures` не хранит переводов имён, подбирать их у
 * клиента нечем, а join делает сервер один раз на всех.
 */
export interface PredictionHistoryEntry {
  fixture_id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_at: string;
  pred_home: number;
  pred_away: number;
  /** NULL значит «матч не сыгран или счёт ещё не забрали» — не 0:0. */
  actual_home: number | null;
  actual_away: number | null;
  points: number | null;
  settled_at: string | null;
}

/**
 * Прогнозы, для которых fixture ещё существует — по имени команды, не по id.
 *
 * `fixtures` хранит только текущий сезон: у старого прогноза fixture рано
 * или поздно исчезает вместе со строкой, на которую он ссылается по
 * внешнему ключу с CASCADE — тогда исчезает и сам прогноз. Пустой список
 * поэтому значит «прогнозов не было» ровно так же надёжно, как и раньше.
 */
export async function fetchPredictionHistory(
  initData: string,
  limit = 50,
): Promise<PredictionHistoryEntry[]> {
  if (!initData) return [];
  const { data, error } = await supabase.rpc('my_prediction_history', {
    p_init_data: initData,
    p_limit: limit,
  });
  if (error) {
    console.error('[predictions] my_prediction_history failed:', error.code, error.message);
    return [];
  }
  return (data as PredictionHistoryEntry[]) ?? [];
}
