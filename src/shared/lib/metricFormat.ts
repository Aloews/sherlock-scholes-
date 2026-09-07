import { formatEur } from './money';

/**
 * Показатели, которые ЯВЛЯЮТСЯ ДЕНЬГАМИ. Список явный, а не догадка по имени:
 * `sw_rating` и `fame` — тоже числа, но евро к ним не приставишь.
 */
const MONEY_METRICS = new Set(['market_value']);

/**
 * Число показателя для показа. `null` значит «числа не было», и это ЗНАЧАЩЕЕ
 * состояние, а не ошибка загрузки: у 4794 действующих игроков нет стоимости, и
 * история говорит об этом прямо. Ноль здесь соврал бы — «стоит нисколько».
 */
export function formatMetric(
  metric: string,
  value: number | null | undefined,
  lang: string,
): string {
  if (value == null) return '—';
  if (MONEY_METRICS.has(metric)) return formatEur(value, lang) ?? String(value);
  return new Intl.NumberFormat(lang).format(value);
}

export interface MetricMove {
  metric: string;
  was: number | null;
  now_value: number | null;
  delta: number | null;
  growth: number | null;
}

/**
 * Что из истории показателей ГОДИТСЯ показать как динамику.
 *
 * ⚠️ ПЕРВЫЙ ЗАМЕР — НЕ ДИНАМИКА, и это главное правило здесь. Хранятся
 * изменения; у карточки, попавшей в историю вчера, `was` пуст у каждого
 * показателя. «Было пусто, стало 600 тыс.» — это появление данных, а не рост
 * стоимости. Одиннадцать таких строк выглядели бы бурной динамикой, не будучи
 * ею вовсе, и первым же вопросом владельца было бы «почему у всех всё выросло».
 *
 * ⚠️ НУЛЕВАЯ РАЗНИЦА ТОЖЕ ВЫБРАСЫВАЕТСЯ: показатель вернулся к прежнему числу,
 * и строка «100 → 100» не сообщает ничего.
 *
 * Порядок — по величине относительного изменения: владелец просил замечать
 * «резкие улучшения одного из показателей», а не листать все одиннадцать.
 */
export function movedMetrics<T extends MetricMove>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.was != null && r.now_value != null
                && r.delta != null && r.delta !== 0)
    .slice()
    .sort((a, b) => Math.abs(relative(b)) - Math.abs(relative(a)));
}

/** Насколько сильно изменился показатель, в долях. Без роста — по разнице. */
function relative(row: MetricMove): number {
  if (row.growth != null) return row.growth - 1;
  if (row.delta == null || row.was == null || row.was === 0) return 0;
  return row.delta / row.was;
}
