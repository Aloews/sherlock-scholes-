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

/** Исход одного матча в строке формы. */
export type FormResult = 'W' | 'D' | 'L';

/**
 * Последние матчи буквами — в массив, старые слева.
 *
 * ⚠️ ПОРЯДОК ЗНАЧИМ, И ПОЭТОМУ ЭТО СТРОКА, А НЕ ТРИ ЧИСЛА. «Три победы, потом
 * два поражения» и «два поражения, потом три победы» дают одинаковые 3-0-2 и
 * описывают разные команды. Владелец просил сухую статистику вместо общих
 * слов — форма и есть самое сухое, что у нас про команду есть.
 *
 * ⚠️ ЧУЖИЕ БУКВЫ ОТБРАСЫВАЮТСЯ, А НЕ ПРЕВРАЩАЮТСЯ В НИЧЬЮ. Строку собирает
 * SQL и других букв давать не должен; если даст — это поломка источника, и
 * молча записать её ничьёй значило бы нарисовать матч, которого не было.
 */
export function parseForm(letters: string | null | undefined): FormResult[] {
  if (!letters) return [];
  return [...letters].filter((c): c is FormResult => c === 'W' || c === 'D' || c === 'L');
}

/** Сколько побед, ничьих и поражений в строке формы. */
export function formRecord(letters: string | null | undefined): {
  w: number; d: number; l: number;
} {
  const r = parseForm(letters);
  return {
    w: r.filter((x) => x === 'W').length,
    d: r.filter((x) => x === 'D').length,
    l: r.filter((x) => x === 'L').length,
  };
}

/** Что известно про одну сторону. Пустое поле — не строка на экране. */
export interface SideFacts {
  traits: string[];
  manager: string | null;
  headline: string | null;
  gf: number | null;
  ga: number | null;
  attack: number | null;
  defence: number | null;
  form: string | null;
}

/**
 * Есть ли у стороны хоть что-то, кроме имени.
 *
 * ⚠️ ПРАВИЛО ВЛАДЕЛЬЦА ЦЕЛИКОМ: «если нет данных, её лучше не писать». Оно
 * сказано было про строку о травмах, но оно шире одной строки, и здесь принято
 * как общее. Сторона без единого факта не рисуется вовсе — ни подписью, ни
 * пустой рамкой.
 */
export function sideHasFacts(s: SideFacts): boolean {
  return s.traits.length > 0
    || s.manager !== null
    || s.headline !== null
    || s.gf !== null
    || s.attack !== null
    || parseForm(s.form).length > 0;
}
