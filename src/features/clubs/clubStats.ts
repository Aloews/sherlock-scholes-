// Что можно сказать о команде, не спрашивая сервер второй раз.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Рядом, в clubsApi.ts, живёт клиент Supabase, а он
// падает при импорте, если не заданы переменные окружения. Держать эти
// функции там значило бы, что проверить их можно только подняв всё окружение,
// то есть на деле никогда. Тот же приём, что у `freshness.ts` рядом с
// `ratingsApi.ts`.

import type { ClubMatchRow, ClubProfile } from './clubsApi';

/** Форма — исходы последних матчей, СВЕЖИЙ СЛЕВА. */
export const FORM_LENGTH = 5;

/**
 * Форма команды из списка матчей.
 *
 * ⚠️ Список приходит от сервера в порядке «свежие сверху», и здесь он НЕ
 * переворачивается: пять последних матчей читаются слева направо от нового к
 * старому, как в любой таблице результатов. Перевернуть его тихо значило бы
 * показать те же буквы задом наперёд — ошибка, которую на экране не увидишь.
 *
 * Матчи без счёта пропускаются, а не считаются ничьими: несыгранный матч —
 * это не ничья, и «Н» на его месте испортила бы и форму, и доверие к ней.
 */
export function formFrom(matches: ClubMatchRow[], length = FORM_LENGTH): string[] {
  return matches
    .filter((m) => m.outcome === 'w' || m.outcome === 'd' || m.outcome === 'l')
    .slice(0, length)
    .map((m) => m.outcome as string);
}

/**
 * Разница мячей со знаком. Ноль остаётся нулём без знака — «+0» читается как
 * опечатка.
 */
export function goalDiff(profile: Pick<ClubProfile, 'goals_for' | 'goals_against'>): string {
  const d = profile.goals_for - profile.goals_against;
  return d > 0 ? `+${d}` : String(d);
}

/**
 * Очки по футбольной шкале: победа 3, ничья 1.
 *
 * ⚠️ ЭТО НЕ ТУРНИРНАЯ ТАБЛИЦА И НЕ ПРИТВОРЯЕТСЯ ЕЮ. Матчи собраны из
 * статистики игроков, то есть у нас есть только те матчи, в которых сыграл
 * хоть кто-то из оцифрованных, — а значит не весь турнир и не весь сезон.
 * Число честно называется «очков в этих матчах», и экран обязан рядом
 * печатать, сколько их было.
 */
export function pointsFrom(profile: Pick<ClubProfile, 'wins' | 'draws'>): number {
  return profile.wins * 3 + profile.draws;
}

/**
 * Доля побед в процентах, целыми.
 *
 * null при нуле матчей, а НЕ ноль: «0% побед» — это утверждение о команде, а
 * пустой список матчей утверждать о ней ничего не может. Та же причина, по
 * которой `ageInDays` не возвращает ноль при отсутствии даты.
 */
export function winRate(profile: Pick<ClubProfile, 'wins' | 'matches'>): number | null {
  if (!profile.matches) return null;
  return Math.round((profile.wins / profile.matches) * 100);
}

/**
 * Голов за матч, с одним знаком после запятой. null при нуле матчей — по той
 * же причине, что и winRate.
 */
export function perMatch(total: number, matches: number): string | null {
  if (!matches) return null;
  return (total / matches).toFixed(1);
}

/**
 * Достаточно ли собрано, чтобы показывать сводку.
 *
 * ⚠️ ПОРОГ СУЩЕСТВУЕТ ПОТОМУ, ЧТО ОДИН МАТЧ ДАЁТ 100% ПОБЕД. Команда, у
 * которой в базе один выигранный матч, выглядела бы сильнейшей в мире, и
 * выглядела бы так убедительно. Три — минимум, при котором доля перестаёт
 * быть пересказом единственного результата.
 */
export const MIN_MATCHES_FOR_RATES = 3;

export function hasEnoughForRates(profile: Pick<ClubProfile, 'matches'>): boolean {
  return profile.matches >= MIN_MATCHES_FOR_RATES;
}
