// Соревновательная арена — вызовы. Чистая часть в `ranked.ts`.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';
import { getRawInitData } from '@/shared/lib/telegram';
import { isRankedStatus, type Outcome, type RankedStatus } from './ranked';

export interface LeaderboardRow {
  telegram_id: number;
  name: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

/**
 * Заявить результат матча.
 *
 * Шлют ОБА игрока, каждый со своей стороны. Сервер засчитывает матч только
 * когда две половины сошлись зеркально — потому что физику считает хост, на
 * своём телефоне, и «я выиграл 5:0» иначе был бы одним POST'ом.
 *
 * `initData` уезжает как есть: подпись проверяет Postgres, а telegram_id
 * берётся оттуда же. Передавать его параметром значило бы разрешить назваться
 * кем угодно.
 */
export async function recordArenaResult(
  code: string,
  outcome: Outcome,
): Promise<RankedStatus> {
  const initData = getRawInitData();
  if (!initData) return 'unauthorized';
  const res = await supabase.rpc('record_arena_result', {
    p_init_data: initData,
    p_code: code,
    p_scored: outcome.scored,
    p_conceded: outcome.conceded,
  });
  if (res.error) {
    console.error('[arena] record', res.error.code ?? '', res.error.message);
    return 'failed';
  }
  // Незнакомый ответ — не успех: см. isRankedStatus.
  return isRankedStatus(res.data) ? res.data : 'failed';
}

/** Таблица за окно в днях. Порядок задаёт SQL. */
export async function fetchArenaLeaderboard(
  days = 30,
  limit = 20,
): Promise<LoadState<LeaderboardRow[]>> {
  const res = await supabase.rpc('arena_leaderboard', { p_days: days, p_limit: limit });
  return fromPostgrest<LeaderboardRow[]>(res, 'arena_leaderboard');
}
