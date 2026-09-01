// Чистая логика турнирной таблицы — без сети, поэтому проверяема тестом.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ: рядом, в clubsApi.ts, живёт клиент Supabase, и он
// падает при импорте без переменных окружения. Тот же приём, что у
// `clubStats.ts` и `freshness.ts`.

import type { LeagueTableRow } from './clubsApi';

/**
 * Очки по строке таблицы — победа 3, ничья 1.
 *
 * ⚠️ СЧИТАЕТСЯ ЗАНОВО НЕ ДЛЯ ПОКАЗА, А ДЛЯ ПРОВЕРКИ. Число `points` приходит
 * с сервера, и показывается именно оно; эта функция существует затем, чтобы
 * тест мог убедиться, что серверная арифметика сходится с футбольной. Два
 * места, считающих одно и то же для ПОКАЗА, разошлись бы — здесь второе место
 * только сверяет.
 */
export function expectedPoints(row: Pick<LeagueTableRow, 'wins' | 'draws'>): number {
  return row.wins * 3 + row.draws;
}

/** Сходится ли строка сама с собой: сыграно = В + Н + П, очки по формуле. */
export function rowIsConsistent(row: LeagueTableRow): boolean {
  return row.played === row.wins + row.draws + row.losses
    && row.points === expectedPoints(row)
    && row.goal_diff === row.goals_for - row.goals_against;
}

/**
 * Ровное ли покрытие: у всех ли команд похожее число матчей.
 *
 * ⚠️ ЭТО НЕ УКРАШЕНИЕ, А ЕДИНСТВЕННЫЙ СПОСОБ ОТЛИЧИТЬ «сезон только начался»
 * ОТ «сбор потерял половину матчей». Наши матчи собраны из статистики игроков,
 * и оба случая на экране выглядят одинаково — маленькие числа в колонке «И».
 * Разница в том, ОДИНАКОВО ли они малы: в начале сезона у всех 1–2, а при
 * потерях у одних 6, у других 1.
 *
 * Порог в два матча — обычный разрыв в календаре: перенесённая игра бывает у
 * любой команды в любой сезон.
 */
export const EVEN_COVERAGE_SPREAD = 2;

export function coverageIsEven(rows: LeagueTableRow[]): boolean {
  if (rows.length === 0) return true;
  const played = rows.map((r) => r.played);
  return Math.max(...played) - Math.min(...played) <= EVEN_COVERAGE_SPREAD;
}

/** Разбор строки формы в исходы. Пустая строка — пустая форма, не выдуманная. */
export function formOutcomes(form: string | null): string[] {
  if (!form) return [];
  return form.split('').filter((c) => c === 'w' || c === 'd' || c === 'l');
}
