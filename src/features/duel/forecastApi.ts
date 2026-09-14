import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Три прогнозиста на ПОБЕДИТЕЛЯ: что назвали, чем кончилось, чему научились.
 *
 * Владелец: «помимо голов указывать победителя», «отдельным экраном дашборд с
 * историями прогнозов от трёх прогнозистов», «продолжать дообучать эти три
 * варианта по мере исходов матчей».
 *
 * ⚠️ ЭКРАН НИЧЕГО НЕ СЧИТАЕТ И НИЧЕМУ НЕ УЧИТ. Прогноз пишется в базу ДО
 * матча ночным прогоном (`football_scraper/forecast_pipeline.py`), сверяется
 * после и только потом попадает сюда. Считать на лету значило бы, что история
 * прогнозов пересчитывается при каждом открытии и всегда выглядит разумной.
 */

export type ForecastModel = 'llm' | 'fly' | 'own';
export type Outcome = 'H' | 'D' | 'A';

export interface UpcomingPick {
  fixture_id: string;
  commence_at: string;
  home_team: string;
  away_team: string;
  llm_pick: Outcome | null;
  llm_conf: number | null;
  fly_pick: Outcome | null;
  fly_conf: number | null;
  own_pick: Outcome | null;
  own_conf: number | null;
  exp_total: number | null;
  /** Сколько прогнозистов сошлись на самом популярном исходе: 1, 2 или 3. */
  agree: number | null;
}

export interface Scoreboard {
  model: ForecastModel;
  graded: number;
  hits: number;
  accuracy: number;
  /** Доля угаданных за последние 30 матчей — видно, учится или сыпется. */
  last30: number | null;
  streak: number;
  /**
   * Сколько исходов дошло до мухи подкреплением.
   *
   * ⚠️ ЭТО НЕ «СКОЛЬКО УГАДАЛА». Дофамин у мухи приходит на КАЖДЫЙ исход, а
   * не на правоту: дофаминовый нейрон отвечает на событие. Число говорит,
   * сколько раз мозг вообще получил обратную связь.
   */
  dopamine: number;
  /** Сколько строк сделано задним числом — на тестовой части. */
  backfilled: number;
}

export interface HistoryRow {
  fixture_id: string;
  commence_at: string;
  home_team: string;
  away_team: string;
  model: ForecastModel;
  pick: Outcome;
  confidence: number;
  actual: Outcome | null;
  correct: boolean | null;
  actual_total: number | null;
  exp_total: number | null;
  dopamine: boolean;
  backfilled: boolean;
}

export async function fetchUpcomingPicks(limit = 20): Promise<LoadState<UpcomingPick[]>> {
  const res = await supabase.rpc('forecast_upcoming', { p_limit: limit });
  return fromPostgrest<UpcomingPick[]>(res, 'forecast_upcoming');
}

export async function fetchScoreboard(): Promise<LoadState<Scoreboard[]>> {
  const res = await supabase.rpc('forecast_scoreboard');
  return fromPostgrest<Scoreboard[]>(res, 'forecast_scoreboard');
}

export async function fetchForecastHistory(
  model: ForecastModel | null,
  limit = 40,
): Promise<LoadState<HistoryRow[]>> {
  const res = await supabase.rpc('forecast_history', {
    p_model: model, p_limit: limit,
  });
  return fromPostgrest<HistoryRow[]>(res, 'forecast_history');
}
