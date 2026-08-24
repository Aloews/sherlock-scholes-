import { describe, it, expect } from 'vitest';
import { tacticFits, DEFAULT_TACTIC, type Tactic, type PositionKey } from './fantasyApi';

/**
 * `tacticFits` — клиентское зеркало серверного `fantasy_tactic_fits`.
 *
 * ЗАЧЕМ ЕГО ТЕСТИРОВАТЬ, если сервер всё равно проверит. Затем, что расхождение
 * этих двух проверок не видно ни с одной стороны: кнопка разрешит отправку,
 * сервер молча ответит false, и игрок увидит «не принято» без единой подсказки,
 * что чинить. Обратное расхождение хуже вдвойне — кнопка заблокирует состав,
 * который сервер бы принял, и починить это игроку нечем вовсе.
 *
 * Правило, которое здесь закрепляется, живёт в
 * supabase/migrations/fantasy_tactics.sql и продублировано тестом
 * supabase/tests/fantasy_tactics.test.sql — числа в обоих обязаны совпадать.
 */

const DEFENSIVE: Tactic = {
  key: 'defensive', clean_sheet_x: 2, goal_x: 0, min_defence: 3, min_forwards: null,
};
const BALANCED: Tactic = {
  key: 'balanced', clean_sheet_x: 1, goal_x: 1, min_defence: null, min_forwards: null,
};
const ATTACKING: Tactic = {
  key: 'attacking', clean_sheet_x: 0, goal_x: 2, min_defence: null, min_forwards: 2,
};

describe('tacticFits', () => {
  it('«Баланс» не требует ничего — подходит любая пятёрка', () => {
    const allMid: PositionKey[] = ['mid', 'mid', 'mid', 'mid', 'mid'];
    expect(tacticFits(allMid, BALANCED)).toBe(true);
    expect(tacticFits([null, null, null, null, null], BALANCED)).toBe(true);
    expect(tacticFits([], BALANCED)).toBe(true);
  });

  it('«Оборона» считает вратаря СВОИМ — иначе требование трёх невыполнимо', () => {
    // Вратарей в туре 65 на 231 защитника; требовать три защитника отдельно от
    // вратаря значило бы наказывать за то, что вратарь в составе один.
    expect(tacticFits(['gk', 'def', 'def', 'mid', 'fwd'], DEFENSIVE)).toBe(true);
    expect(tacticFits(['def', 'def', 'def', 'mid', 'fwd'], DEFENSIVE)).toBe(true);
  });

  it('«Оборона»: двоих сзади мало', () => {
    expect(tacticFits(['gk', 'def', 'mid', 'mid', 'fwd'], DEFENSIVE)).toBe(false);
  });

  it('«Атака» требует ровно двух нападающих, не больше', () => {
    expect(tacticFits(['fwd', 'fwd', 'mid', 'mid', 'def'], ATTACKING)).toBe(true);
    expect(tacticFits(['fwd', 'mid', 'mid', 'mid', 'def'], ATTACKING)).toBe(false);
  });

  it('КАРТОЧКА БЕЗ ПОЗИЦИИ НЕ ЗАКРЫВАЕТ НИ ОДНУ ЛИНИЮ', () => {
    // null — это «мы не знаем», а не «универсал». Засчитать её за защитника
    // значило бы выдумать факт, которого в данных нет: позиции нет у 45 из 787
    // карточек тура, и это пробел обогащения, а не свойство игрока.
    expect(tacticFits(['gk', 'def', null, 'mid', 'fwd'], DEFENSIVE)).toBe(false);
    expect(tacticFits(['fwd', null, 'mid', 'mid', 'def'], ATTACKING)).toBe(false);
  });

  it('лишние игроки нужной линии требованию не мешают', () => {
    expect(tacticFits(['gk', 'def', 'def', 'def', 'def'], DEFENSIVE)).toBe(true);
    expect(tacticFits(['fwd', 'fwd', 'fwd', 'fwd', 'fwd'], ATTACKING)).toBe(true);
  });

  it('схема по умолчанию — единственная без требований к составу', () => {
    // Ею же сервер подставляет заявку из старого фронтенда (легаси-шим
    // set_fantasy_squad на четыре аргумента). Будь у неё требование, тот
    // фронтенд начал бы получать отказы на составы, которые раньше проходили.
    expect(DEFAULT_TACTIC).toBe('balanced');
    expect(BALANCED.min_defence).toBeNull();
    expect(BALANCED.min_forwards).toBeNull();
  });
});
