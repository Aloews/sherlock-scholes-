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
