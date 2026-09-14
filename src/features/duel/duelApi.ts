import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Состязание трёх прогнозистов — данные для дашборда.
 *
 * Владелец: «дашборд нужен с удачными исходами матчей внутри pro версии
 * Шерлок Скоулс и сравнением двух моделей „прогнозистов“: а) ллм б) мозг
 * дрозофилы в) свой вариант, улучшенный».
 *
 * ⚠️ ЧИСЛА СЧИТАЮТСЯ НЕ ЗДЕСЬ И НЕ СЕЙЧАС. Обучение идёт отдельным прогоном
 * (football_scraper/forecast_duel.py) на матчах, которых модели не видели, и
 * кладёт итог в таблицы. Экран только показывает. Считать «на лету» значило
 * бы переобучать модель на каждое открытие — и получать каждый раз новое
 * число, потому что часть матчей за это время становится обучающей.
 */

/** Какие бывают участники. Порядок задаёт сервер, не экран. */
export type DuelModel = 'own' | 'llm' | 'fly' | 'median' | 'current';

export interface DuelRow {
  model: DuelModel;
  /** Средняя ошибка в голах. Меньше — лучше. */
  mae: number;
  /** Доля угаданных исходов — ТОЛЬКО по названным матчам. */
  hit_rate: number;
  /**
   * Какую долю матчей участник вообще назвал.
   *
   * ⚠️ ПОКАЗЫВАТЬ ДОЛЮ УГАДАННЫХ БЕЗ ЭТОГО ЧИСЛА НЕЛЬЗЯ. «Свой вариант»
   * молчит там, где не уверен, и его 66 % — это 66 % на четырёх матчах из
   * десяти. Рядом с чужими 58 % на всех десяти это разные вещи.
   */
  coverage: number;
  matches: number;
  params: Record<string, number>;
  trained_at: string;
}

export interface DuelMatch {
  match_date: string;
  home_name: string | null;
  away_name: string | null;
  total: number;
  p_llm: number;
  p_fly: number;
  p_own: number;
  own_called: boolean;
  hit_llm: boolean;
  hit_fly: boolean;
  /** null — свой вариант промолчал. Это не промах и не попадание. */
  hit_own: boolean | null;
}

export async function fetchDuelModels(): Promise<LoadState<DuelRow[]>> {
  const res = await supabase.rpc('forecast_duel_models');
  return fromPostgrest<DuelRow[]>(res, 'forecast_duel_models');
}

export async function fetchDuelMatches(
  lang: string,
  limit = 40,
): Promise<LoadState<DuelMatch[]>> {
  const res = await supabase.rpc('forecast_duel_recent', {
    p_lang: lang.slice(0, 2),
    p_limit: limit,
  });
  return fromPostgrest<DuelMatch[]>(res, 'forecast_duel_recent');
}
