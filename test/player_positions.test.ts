import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * СПИСОК АМПЛУА В TypeScript ОБЯЗАН СОВПАДАТЬ С CHECK В SQL.
 *
 * ⚠️ РАЗЪЕХАВШИЙСЯ СПИСОК — ЭТО КНОПКА, КОТОРАЯ МОЛЧА ОТБИРАЕТ НОЛЬ. База
 * такую строку не примет (на колонке стоит CHECK), но `player_index` на
 * незнакомое значение отвечает не ошибкой, а пустым списком: экран покажет
 * «нападающих нет», и это неотличимо от «конвейер не проставил амплуа».
 *
 * Тот же класс, что и с `INDEX_SORTS` рядом: в шапке `ratingsApi.ts` записано,
 * что имена сортировок обязаны совпадать с веткой `case` в SQL — и по той же
 * причине, «разъедутся — экран молча покажет не то».
 */

const MIGRATION = 'supabase/migrations/card_position.sql';

/** Значения из CHECK на колонке `position`. */
function fromSql(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const m = sql.match(/check \(position in \(([^)]+)\)\)/);
  if (!m) throw new Error('в миграции не нашёлся CHECK на position');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
}

// ⚠️ ИМПОРТ ИЗ `positions`, А НЕ ИЗ `ratingsApi`, И ЭТО НЕ ПРИДИРКА. Второй
// тянет клиент Supabase, который падает на загрузке без VITE_-переменных:
// тест на четыре строки требовал бы поднятого окружения и не гонялся бы
// вовсе. Ровно поэтому список и вынесен в отдельный pure-модуль.
async function fromTs(): Promise<string[]> {
  const { POSITIONS } = await import('../src/features/ratings/positions');
  return [...POSITIONS].sort();
}

describe('амплуа: один список на две стороны', () => {
  it('TypeScript и SQL называют одни и те же четыре', async () => {
    expect(await fromTs()).toEqual(fromSql());
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: проверка обязана уметь падать. Без него она
  // зеленела бы и на регулярке, которая не находит ничего никогда.
  it('контроль: лишнее амплуа замечается', async () => {
    expect([...(await fromTs()), 'либеро'].sort()).not.toEqual(fromSql());
  });

  it('контроль: пропавшее амплуа замечается', async () => {
    expect((await fromTs()).slice(1)).not.toEqual(fromSql());
  });

  // ⚠️ И САМА РЕГУЛЯРКА ЧТО-ТО НАХОДИТ. Четыре — не догадка: столько значений
  // у Transfermarkt, и на них построены и таблица, и кнопки.
  it('контроль: в SQL их ровно четыре', () => {
    expect(fromSql()).toEqual(['attack', 'defender', 'goalkeeper', 'midfield']);
  });
});
