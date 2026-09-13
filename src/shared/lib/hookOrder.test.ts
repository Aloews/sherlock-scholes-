import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ХУК ПОСЛЕ ДОСРОЧНОГО ВЫХОДА — ЭТО БЕЛЫЙ ЭКРАН, А НЕ ПРИДИРКА К СТИЛЮ.
 *
 * ⚠️ ЭТА ПРОВЕРКА НАПИСАНА ПО СЛЕДАМ ЖИВОЙ ПОЛОМКИ. В `ScopeFilter` `useMemo`
 * стоял ниже `if (facets.length === 0) return null`: у категории без фасетов
 * компонент отдавал четыре хука, у категории с фасетами — пять. React роняет
 * на этом ВСЁ ПОДДЕРЕВО:
 *
 *   Minified React error #310 — Rendered more hooks than during the
 *   previous render
 *
 * Снаружи это — «коллекции зависают»: экран гаснет и перестаёт отвечать.
 * Владелец сообщал трижды. Ни tsc, ни сборка, ни восемь сотен тестов этого не
 * видели: типы сходятся, бандл собирается, падает только в браузере и только
 * при ПЕРЕХОДЕ между категориями.
 *
 * ⚠️ ПОЧЕМУ ПРОВЕРКА, А НЕ ESLint. Правило `react-hooks/rules-of-hooks` ловит
 * ровно это, но eslint в проекте нет вовсе, и заводить его ради одного
 * правила — это новая зависимость, новый конфиг и новый шаг в CI. Здесь
 * тридцать строк без единой зависимости, и они ловят тот же класс.
 *
 * ⚠️ ЧТО ЭТА ПРОВЕРКА НЕ ЛОВИТ, И ЭТО СКАЗАНО ПРЯМО. Она смотрит на отступы:
 * «выход на верхнем уровне функции» — строка с отступом ровно в два пробела,
 * «хук на верхнем уровне» — тоже. Хук внутри `if { ... }` или внутри цикла она
 * не увидит; для этого нужен разбор синтаксиса, а не строк. Она ловит тот
 * случай, который уже случился, и делает это без зависимостей.
 */

const SRC = 'src';
const HOOK = /^ {2}(?:const|let|var)?\s*[\w{},[\]\s:]*=?\s*use[A-Z]\w*\s*\(/;
const EARLY_RETURN = /^ {2}(?:if\s*\(.*\)\s*)?return\b/;
/** Начало функции верхнего уровня — компонент или хук. */
const TOP_FN = /^(?:export\s+)?(?:async\s+)?function\s+\w+/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

/** Функции, где хук вызывается ПОСЛЕ выхода на том же уровне. */
export function conditionalHooks(source: string): string[] {
  const lines = source.split('\n');
  const bad: string[] = [];
  let fn: string | null = null;
  let returned = false;

  for (const line of lines) {
    if (TOP_FN.test(line)) {
      fn = line.trim().slice(0, 60);
      returned = false;
      continue;
    }
    if (line === '}') { fn = null; continue; }
    if (!fn) continue;
    if (EARLY_RETURN.test(line)) { returned = true; continue; }
    if (returned && HOOK.test(line)) {
      bad.push(`${fn} → ${line.trim().slice(0, 60)}`);
      returned = false; // об одной функции сообщаем один раз
    }
  }
  return bad;
}

describe('порядок хуков', () => {
  it('ни один компонент не зовёт хук после досрочного выхода', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const hit of conditionalHooks(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: на заведомо сломанном коде проверка обязана
  // сработать. Без него она зеленела бы и на регулярке, которая не находит
  // ничего никогда, — а именно так проверка становится пустой.
  it('контроль: сломанный порядок находится', () => {
    const broken = [
      'export function Bad() {',
      '  const [x, setX] = useState(0);',
      '  if (x === 0) return null;',
      '  const y = useMemo(() => x, [x]);',
      '  return y;',
      '}',
    ].join('\n');
    expect(conditionalHooks(broken)).toHaveLength(1);
  });

  it('контроль: выход ПОСЛЕ всех хуков придиркой не считается', () => {
    const fine = [
      'export function Good() {',
      '  const [x, setX] = useState(0);',
      '  const y = useMemo(() => x, [x]);',
      '  if (x === 0) return null;',
      '  return y;',
      '}',
    ].join('\n');
    expect(conditionalHooks(fine)).toEqual([]);
  });
});
