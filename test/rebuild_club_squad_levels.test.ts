import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ОДНА НОЧНАЯ ФУНКЦИЯ ОПИСАНА В ДВУХ МИГРАЦИЯХ — ТЕЛА ОБЯЗАНЫ СОВПАДАТЬ.
 *
 * ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ НАСТОЯЩЕЙ ЛОВУШКИ, ЗАВЕДЁННОЙ В ЭТОЙ ЖЕ ВЕТКЕ.
 * `rebuild_club_squad_levels()` наполняет три ночные памятки, и две миграции
 * писались в разное время: `club_squad_fame.sql` добавила известность,
 * `club_directory_fast.sql` — справочник клубов. Обе делают
 * `create or replace`, то есть КАЖДАЯ ПЕРЕЗАПИСЫВАЕТ ФУНКЦИЮ ЦЕЛИКОМ.
 *
 * Пока тела различались, исход решал порядок применения. По именам
 * `club_directory_fast.sql` идёт РАНЬШЕ `club_squad_fame.sql`, поэтому
 * применение «по алфавиту» — самое естественное — оставляло в базе короткую
 * версию: `club_directory_facts` переставала наполняться совсем.
 *
 * Такая поломка не краснеет НИГДЕ. Функция отвечает, строки есть, экран
 * рисуется — просто числа застывают на дне последней удачной сборки, и
 * наружу это выходит неделями позже неверным составом и неверной стоимостью.
 * Ровно тот же класс, что «забытая в списке Edge-функция» рядом в
 * `deploy_functions.test.ts`: тихо, правдоподобно и надолго.
 *
 * Поэтому тела сведены к одному тексту, а расхождение ловится здесь — до
 * пуша, а не через месяц на боевой базе.
 */

const FILES = [
  'supabase/migrations/club_squad_fame.sql',
  'supabase/migrations/club_directory_fast.sql',
] as const;

const START = 'create or replace function public.rebuild_club_squad_levels()';
const END = '\n$$;\n';

/** Тело функции от `create or replace` до закрывающего `$$;` включительно. */
function body(file: string): string {
  const sql = readFileSync(file, 'utf8');
  const from = sql.indexOf(START);
  expect(from, `${file}: определения rebuild_club_squad_levels нет вовсе`).toBeGreaterThan(-1);
  const to = sql.indexOf(END, from);
  expect(to, `${file}: определение не закрыто \`$$;\``).toBeGreaterThan(-1);
  return sql.slice(from, to + END.length);
}

describe('rebuild_club_squad_levels в миграциях', () => {
  it('описана одинаково во всех файлах, которые её переписывают', () => {
    const [fame, directory] = FILES.map(body);
    expect(fame).toBe(directory);
  });

  it('наполняет все три ночные памятки, а не часть', () => {
    // Порядок применения не должен решать, какие таблицы останутся живыми.
    for (const file of FILES) {
      const text = body(file);
      for (const table of ['club_squad_level', 'club_squad_fame', 'club_directory_facts']) {
        expect(text, `${file}: не наполняет ${table}`).toContain(`delete from ${table};`);
        expect(text, `${file}: не пишет в ${table}`).toContain(`insert into ${table} (`);
      }
    }
  });

  it('расписание зовёт её по имени ровно одно — второй записи в cron нет', () => {
    // Имя функции шире её содержимого сознательно: три памятки собираются
    // одной строкой pg_cron. Если кто-то заведёт вторую функцию и забудет
    // вторую запись в расписании, памятка будет стареть молча.
    const scheduled = FILES.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]),
    );
    expect(scheduled).toEqual([]);
  });
});
