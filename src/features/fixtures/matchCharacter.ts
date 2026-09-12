// Чистая часть характера матча: то, что можно проверить, не поднимая сети.
//
// Отдельным модулем по той же причине, что и digestFormat: файл с вызовом RPC
// импортирует клиент Supabase, а тот падает на старте без VITE_-переменных, и
// тогда тест на две ветки арифметики требовал бы поднятого окружения.

/** Сколько голов ждать. Три ступени, а не число: число обещало бы счёт. */
export type GoalsBand = 'low' | 'mid' | 'high';
/** Каким будет течение игры. */
export type FlowBand = 'closed' | 'balanced' | 'open';

export interface CharacterBands {
  goals: GoalsBand;
  flow: FlowBand;
}

/**
 * ПОРОГИ ИЗМЕРЕНЫ, А НЕ ВЫБРАНЫ КРАСИВО.
 *
 * Замер 09.09.2026 по 18 ближайшим матчам, у которых характер есть с обеих
 * сторон: ожидаемые голы 2.40 … 3.00 … 4.10 (мин, медиана, макс), открытость
 * 15 … 57 … 97.
 *
 * Отсюда границы: медиана обязана попадать в СРЕДНЮЮ полосу, иначе половина
 * матчей называлась бы «результативным» или «закрытым» и слово перестало бы
 * что-либо значить — ровно тот же довод, по которому у черт клуба порог 70/30,
 * а не 50.
 */
export const GOALS_LOW = 2.7;
export const GOALS_HIGH = 3.3;
export const FLOW_CLOSED = 35;
export const FLOW_OPEN = 70;

/**
 * Полосы по двум числам — или null, если считать не из чего.
 *
 * ⚠️ NULL, А НЕ «СРЕДНЕЕ ПО УМОЛЧАНИЮ». Характер есть у 366 клубов, и у
 * доброй половины ближайших матчей одна из сторон без него. Показать таким
 * «сбалансированный» значило бы выдать незнание за измерение — та же ошибка,
 * из-за которой уровень игрока когда-то показывал ноль вместо пустоты.
 */
export function characterBands(
  expectedGoals: number | null | undefined,
  openness: number | null | undefined,
): CharacterBands | null {
  if (expectedGoals === null || expectedGoals === undefined) return null;
  if (openness === null || openness === undefined) return null;
  return {
    goals: expectedGoals >= GOALS_HIGH ? 'high' : expectedGoals < GOALS_LOW ? 'low' : 'mid',
    flow: openness >= FLOW_OPEN ? 'open' : openness < FLOW_CLOSED ? 'closed' : 'balanced',
  };
}

/**
 * На скольких матчах построено утверждение — МЕНЬШЕЕ ИЗ ДВУХ.
 *
 * Не сумма и не среднее: утверждение о матче не может быть надёжнее, чем
 * знание о худшей из его сторон. «74 и 12» — это 12, а не 86 и не 43.
 */
export function characterMatches(
  home: number | null | undefined,
  away: number | null | undefined,
): number | null {
  if (home === null || home === undefined) return null;
  if (away === null || away === undefined) return null;
  return Math.min(home, away);
}
