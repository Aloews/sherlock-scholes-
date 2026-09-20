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

/**
 * ⚠️ ПАРОЛЬ ПЕРСОНАЛА — ВТОРОЙ КЛЮЧ, И БЕЗ НЕГО ДОСКА НЕ ОТКРЫВАЛАСЬ ВОВСЕ.
 * Эти функции закрыты `require_pro()`, который проверяет подпись Telegram.
 * Пока доска висела на /duel, её открывали ИЗ Telegram с подпиской и всё
 * сходилось. После переезда в /admin вход стал по паролю из обычного
 * браузера, где заголовка `x-tg-init-data` нет и быть не может, — и экран
 * отвечал `pro_required` при живых данных под ним.
 *
 * Пароль не снимает проверку, а добавляет второй способ её пройти: без
 * подписи И без верного пароля отказ прежний.
 */
export async function fetchUpcomingPicks(
  limit = 20, password: string | null = null,
): Promise<LoadState<UpcomingPick[]>> {
  const res = await supabase.rpc('forecast_upcoming', {
    p_limit: limit, p_password: password,
  });
  return fromPostgrest<UpcomingPick[]>(res, 'forecast_upcoming');
}

export async function fetchScoreboard(
  password: string | null = null,
): Promise<LoadState<Scoreboard[]>> {
  const res = await supabase.rpc('forecast_scoreboard', { p_password: password });
  return fromPostgrest<Scoreboard[]>(res, 'forecast_scoreboard');
}

/** Курсор страницы: последняя показанная строка. */
export interface HistoryCursor {
  commence_at: string;
  fixture_id: string;
}

/**
 * Страница истории.
 *
 * ⚠️ КУРСОРОМ, А НЕ СМЕЩЕНИЕМ. История растёт до десятков тысяч строк, а
 * `offset N` заставляет базу прочитать и выбросить N строк: десятая страница
 * дешёвая, трёхсотая — нет, и тормозит она ровно тогда, когда истории
 * накопилось много. Курсор по (commence_at, fixture_id) стоит одинаково на
 * любой глубине.
 *
 * Оба поля курсора передаются вместе. Время матча не уникально — у тура оно
 * совпадает до секунды, — поэтому вторым ключом идёт `fixture_id`; иначе
 * страница либо зациклится, либо перескочит одновременно начавшиеся матчи.
 */
export async function fetchForecastHistory(
  model: ForecastModel | null,
  limit = 40,
  after: HistoryCursor | null = null,
  password: string | null = null,
): Promise<LoadState<HistoryRow[]>> {
  const res = await supabase.rpc('forecast_history', {
    p_model: model,
    p_limit: limit,
    p_before_at: after?.commence_at ?? null,
    p_before_id: after?.fixture_id ?? null,
    p_password: password,
  });
  return fromPostgrest<HistoryRow[]>(res, 'forecast_history');
}

/** Сколько строк в истории всего — чтобы экран не делал вид, что показал всё. */
export async function fetchHistoryCount(
  model: ForecastModel | null, password: string | null = null,
): Promise<LoadState<number>> {
  const res = await supabase.rpc('forecast_history_count', {
    p_model: model, p_password: password,
  });
  return fromPostgrest<number>(res, 'forecast_history_count');
}

// ── экспрессы: только для админа ─────────────────────────────────────────────
//
// ⚠️ §4.4 docs/LIVE_FOOTBALL_HANDOFF.md: игроку не показывают ни
// коэффициентов, ни производных от них, и держится это отсутствием политики
// RLS у `fixture_odds`. Здесь граница не сдвинута: таблицу клиент по-прежнему
// не читает, а функция ниже требует пароль персонала. Ничего из этого не
// должно попасть ни на один экран, кроме /admin.

export interface AccumulatorLeg {
  fixture_id: string;
  commence_at: string;
  home_team: string;
  away_team: string;
  pick: Outcome;
  /** Десятичный коэффициент на выбранный исход, медиана по букмекерам. */
  price: number;
  /** Вероятность БЕЗ маржи: обратная величина, делённая на overround. */
  fair_prob: number;
  books: number;
  /** Сколько наших моделей назвали то же самое. Сигнал посмотреть, не поправка. */
  models_agree: number;
  model_picks: string | null;
}

export async function fetchAccumulator(
  password: string, legs = 4, minProb = 0.6, hours = 72,
): Promise<LoadState<AccumulatorLeg[]>> {
  const res = await supabase.rpc('admin_accumulator', {
    p_password: password, p_legs: legs, p_min_prob: minProb, p_hours: hours,
  });
  return fromPostgrest<AccumulatorLeg[]>(res, 'admin_accumulator');
}

/**
 * Арифметика экспресса. Считается ЗДЕСЬ, а не в базе, потому что зависит от
 * того, какие ноги админ оставил на экране.
 *
 * ⚠️ ОЖИДАЕМЫЙ ВОЗВРАТ ВСЕГДА МЕНЬШЕ ЕДИНИЦЫ, И ЭТО НЕ ОШИБКА РАСЧЁТА.
 * Вероятности очищены от маржи, а выплата — нет: она и есть цена букмекера
 * вместе с его маржой. Перемножение возвращает ровно то, что рынок обещает
 * в среднем, и оно меньше вложенного. Замер на живых котировках 20.09.2026:
 * одна нога 0.934, две 0.877, четыре 0.773, шесть 0.658 — чем длиннее
 * экспресс, тем хуже И проходимость, И возврат.
 */
export function accumulatorMath(legs: AccumulatorLeg[]): {
  passRate: number; payout: number; expectedReturn: number;
} {
  if (legs.length === 0) return { passRate: 0, payout: 0, expectedReturn: 0 };
  const passRate = legs.reduce((a, l) => a * l.fair_prob, 1);
  const payout = legs.reduce((a, l) => a * l.price, 1);
  return { passRate, payout, expectedReturn: passRate * payout };
}
