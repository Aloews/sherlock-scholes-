import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { needsSignature } from '../src/shared/lib/signatureScope';

/**
 * СПИСОК ФУНКЦИЙ В КНОПКЕ ВЫКЛАДКИ ОБЯЗАН СОВПАДАТЬ С ПАПКОЙ.
 *
 * ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ ЖИВОЙ ПОЛОМКИ, ПУСТЬ И В СОСЕДНЕМ РЕПОЗИТОРИИ. В
 * sherlock-ai-bot Dockerfile копировал файлы поимённо, новый модуль в список
 * не попал — и контейнер не поднялся вовсе:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/livekit.js'
 *
 * Прод при этом не упал: Railway держал прежнее удачное развёртывание. То
 * есть поломка была ТИХОЙ, и нашлась только в логах после провалившегося
 * healthcheck. Здесь ровно тот же класс: забытая в списке функция просто не
 * выложится, и узнать об этом можно будет только по тому, что она ведёт себя
 * как вчера.
 *
 * Сам workflow сверяет списки и на прогоне — но там это стоит минуту очереди
 * и красный прогон; здесь то же самое стоит миллисекунду до пуша.
 */

function knownFromWorkflow(): string[] {
  const yml = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const m = yml.match(/^\s*KNOWN="([^"]+)"/m);
  if (!m) throw new Error('в deploy.yml не нашлась строка KNOWN="…"');
  return m[1].trim().split(/\s+/).sort();
}

const onDisk = () => readdirSync('supabase/functions').sort();

describe('кнопка выкладки знает все Edge-функции', () => {
  it('список в deploy.yml совпадает с папкой', () => {
    expect(knownFromWorkflow()).toEqual(onDisk());
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: проверка обязана уметь падать. Без него она
  // зеленела бы и на регулярке, которая не находит ничего никогда, — а это
  // ровно тот случай, когда зелёная проверка врёт с уверенностью.
  it('контроль: лишнее имя в списке замечается', () => {
    expect([...knownFromWorkflow(), 'выдуманная-функция'].sort())
      .not.toEqual(onDisk());
  });

  it('контроль: пропущенное имя замечается', () => {
    expect(knownFromWorkflow().slice(1)).not.toEqual(onDisk());
  });
});

/**
 * У КАЖДОГО ОБРАЩЕНИЯ НАРУЖУ ОБЯЗАН БЫТЬ СРОК.
 *
 * ⚠️ ЗАПРОС БЕЗ СРОКА НЕ ПАДАЕТ — ОН ВИСИТ, а висящий сборщик неотличим от
 * работающего. Ровно этим ночной обход шёл 3 ч 36 мин при бюджете 80 минут:
 * разбор в CLAUDE.md, «Прогон по расписанию обязан уметь краснеть». В
 * Edge-функциях та же дыра была ШИРЕ: на 22.09.2026 срок стоял у одной
 * функции из десяти, остальные тридцать три вызова висели бы до потолка
 * платформы.
 *
 * Засчитывается один из двух способов, и оба настоящие:
 *   1. модуль затеняет `fetch` обёрткой со сроком — тогда срок получает и
 *      вызов, дописанный завтра;
 *   2. у КАЖДОГО вызова свой `AbortSignal.timeout`.
 *
 * Второй способ проверяется счётом: «где-то в файле есть AbortSignal» зеленело
 * бы на файле с десятью вызовами и одним сроком.
 */
describe('сроки у обращений наружу', () => {
  const functions = readdirSync('supabase/functions');

  it.each(functions)('%s не может зависнуть на запросе', (name) => {
    const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    // Вызовы fetch, кроме самого объявления обёртки.
    const calls = [...src.matchAll(/(?<![.\w])fetch\(/g)].length
      - [...src.matchAll(/const fetch = /g)].length;
    if (calls <= 0) return; // функция наружу не ходит — нечему виснуть

    const wrapped = /const bareFetch = globalThis\.fetch/.test(src)
      && /init\.signal \?\? AbortSignal\.timeout\(/.test(src);
    const signals = [...src.matchAll(/AbortSignal\.timeout\(/g)].length;
    expect(
      wrapped || signals >= calls,
      `${name}: ${calls} вызовов, сроков ${signals}, обёртки нет`,
    ).toBe(true);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: проверка обязана уметь падать. Без него она
  // зеленела бы и на регулярке, не находящей вызовов никогда, — то есть на
  // «ни одна функция наружу не ходит».
  it('контроль: вызовы наружу вообще находятся', () => {
    const total = functions.reduce((n, name) => {
      const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      return n + [...src.matchAll(/(?<![.\w])fetch\(/g)].length;
    }, 0);
    expect(total).toBeGreaterThan(20);
  });
});

/**
 * CORS ФУНКЦИИ ОБЯЗАН ПОКРЫВАТЬ ТО, ЧТО КЛИЕНТ ДЕЙСТВИТЕЛЬНО ШЛЁТ.
 *
 * ⚠️ ТЕСТ ПО ЖИВОЙ ПОЛОМКЕ, И ОНА БЫЛА ТИХОЙ. Ворота Pro добавили подпись
 * Telegram заголовком `x-tg-init-data` на КАЖДЫЙ запрос клиента Supabase — в
 * том числе на `functions.invoke`. На нестандартный заголовок браузер шлёт
 * предзапрос OPTIONS; список разрешённых у Edge-функций прибит гвоздями, и
 * браузер заблокировал вызов ЦЕЛИКОМ, ещё до отправки.
 *
 * Владелец: «сводка новостей по кнопке „собрать сводку“ не работает». Вместе с
 * ней молча перестали работать вход в комнату, ОПЛАТА Pro и загрузка логотипа.
 * Сервер был жив — прямой POST отвечал 200 за 2.6 с, — поэтому ни curl, ни
 * сотня проверок этого не видели: предзапрос делает БРАУЗЕР.
 *
 * ⚠️ ПОЭТОМУ ЗДЕСЬ СВЕРЯЮТСЯ ДВЕ СТОРОНЫ, А НЕ ОДНА. Набор заголовков берётся
 * из того же правила, по которому живёт клиент (`needsSignature`), и
 * сравнивается со списком в функции. Расширить правило и забыть про CORS
 * теперь нельзя: тест покраснеет здесь, а не у игрока на экране.
 */
const CALLED_FROM_BROWSER = [
  'digest-summary',
  'livekit-token',
  'tg-pay',
  'amateur-logo',
];

/** Что клиент Supabase кладёт в запрос к Edge-функции. */
function headersClientSends(fnUrl: string): string[] {
  const base = ['authorization', 'content-type', 'apikey', 'x-client-info'];
  return needsSignature(fnUrl) ? [...base, 'x-tg-init-data'] : base;
}

describe('CORS Edge-функций', () => {
  it.each(CALLED_FROM_BROWSER)('%s разрешает всё, что шлёт клиент', (name) => {
    const url = `https://example.supabase.co/functions/v1/${name}`;
    const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    const m = src.match(/"Access-Control-Allow-Headers":\s*"([^"]+)"/);
    expect(m, `в ${name} не нашёлся Access-Control-Allow-Headers`).toBeTruthy();
    const allowed = m![1].toLowerCase().split(',').map((x) => x.trim());
    for (const h of headersClientSends(url)) {
      expect(allowed, `${name} не пропускает ${h}`).toContain(h);
    }
  });

  // ⚠️ СПИСОК ВЫШЕ ОБЯЗАН СОВПАДАТЬ С ТЕМ, ЧТО ДЕЙСТВИТЕЛЬНО ЗОВЁТ КОД.
  // Иначе новая функция, добавленная во фронтенд, сломается ровно так же, а
  // этот тест останется зелёным — он просто про неё не узнает.
  it('список совпадает с вызовами supabase.functions.invoke в коде', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk('src');
    const called = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/functions\.invoke\(\s*['"]([^'"]+)['"]/g)) {
        called.add(m[1]);
      }
    }
    expect([...called].sort()).toEqual([...CALLED_FROM_BROWSER].sort());
  });
});
