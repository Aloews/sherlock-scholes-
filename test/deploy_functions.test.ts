import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

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
 * ФУНКЦИЯ, КОТОРУЮ ЗОВЁТ БРАУЗЕР, ОБЯЗАНА ПРОПУСКАТЬ ПОДПИСЬ TELEGRAM.
 *
 * ⚠️ ПРОВЕРКА ПО ЖИВОЙ ПОЛОМКЕ. Владелец: «сводка новостей по кнопке „собрать
 * сводку“ не работает». Прямой POST к `digest-summary` в ту же минуту отвечал
 * HTTP 200 за 2.6 с: сервер был жив, а кнопка — нет.
 *
 * Клиент Supabase собран со своим fetch и подписывает КАЖДЫЙ запрос заголовком
 * `x-tg-init-data`; `functions.invoke` идёт через тот же fetch. На
 * нестандартный заголовок браузер шлёт предзапрос OPTIONS, и если сервер его не
 * разрешил — блокирует запрос ЦЕЛИКОМ, ещё до отправки. PostgREST отвечает
 * эхом, поэтому экраны работали; у Edge-функций список прибит гвоздями, и
 * сломалось разом всё, что зовётся из браузера: сводка, вход в комнату, оплата
 * и загрузка логотипа.
 *
 * ⚠️ CURL ЭТОГО НЕ ПОЙМАЕТ: предзапрос делает браузер, а не сервер. В
 * `check-prod` есть тот же вопрос, заданный боевому адресу; здесь — до пуша.
 */
const CALLED_FROM_BROWSER = [
  'digest-summary',
  'livekit-token',
  'tg-pay',
  'amateur-logo',
];

describe('CORS Edge-функций', () => {
  it.each(CALLED_FROM_BROWSER)('%s пропускает x-tg-init-data', (name) => {
    const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    const m = src.match(/"Access-Control-Allow-Headers":\s*"([^"]+)"/);
    expect(m, `в ${name} не нашёлся Access-Control-Allow-Headers`).toBeTruthy();
    expect(m![1].toLowerCase()).toContain('x-tg-init-data');
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
