import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ПОРОГ ОТБОРА ПЛЕЧ ВЫПИСАН ЧЕТЫРЕ РАЗА — И ВСЕ ЧЕТЫРЕ ОБЯЗАНЫ СОВПАДАТЬ.
 *
 * Экспрессы собираются двумя функциями: `build_model_accumulators` — на
 * будущие матчи, `backfill_model_accumulators` — на сыгранные. Обе отбирают
 * плечи ОДНИМ И ТЕМ ЖЕ правилом, и у каждой порог написан ДВАЖДЫ: в
 * умолчании параметра и в `coalesce(p_floor, …)` внутри запроса.
 *
 * ⚠️ РАЗЪЕХАВШИЙСЯ ПОРОГ НЕ ПАДАЕТ НИГДЕ. Живые билеты собираются по одному
 * правилу, история — по другому, а сводка кладёт их в одну таблицу и
 * сравнивает факт с ожиданием. Получается сравнение разных правил под одним
 * именем: ни SQL, ни экран, ни `check-prod` такого не заметят — билеты есть,
 * числа есть, они просто про разное.
 *
 * ⚠️ И ВТОРАЯ ПАРА, КОТОРУЮ ЛЕГКО НЕ ЗАМЕТИТЬ: умолчание против `coalesce`.
 * Вызов без аргумента берёт умолчание, вызов с явным `null` — `coalesce`.
 * Разойдись они, и `build_model_accumulators()` из расписания собирал бы по
 * одному порогу, а `select build_model_accumulators(null)` руками — по
 * другому, причём оба «работают».
 *
 * Порог менялся 21.09.2026 с 0.45 на 0.47 по просьбе владельца — ровно тот
 * случай, когда правку легко внести в трёх местах из четырёх.
 */

const SQL = 'supabase/migrations/accumulator_from_models.sql';

function sql(): string {
  return readFileSync(SQL, 'utf8');
}

/** Умолчание параметра `p_floor` у названной функции. */
function declaredFloor(fn: string): string {
  const text = sql();
  const at = text.indexOf(`function public.${fn}(`);
  expect(at, `${fn}: определения нет вовсе`).toBeGreaterThan(-1);
  const head = text.slice(at, text.indexOf(')', at));
  const m = /p_floor\s+numeric\s+default\s+([0-9.]+)/.exec(head);
  expect(m, `${fn}: у p_floor нет умолчания`).not.toBeNull();
  return m![1];
}

/** Все запасные значения `coalesce(p_floor, …)` в теле названной функции. */
function coalesceFloors(fn: string): string[] {
  const text = sql();
  const at = text.indexOf(`function public.${fn}(`);
  const end = text.indexOf('\n$$;\n', at);
  const body = text.slice(at, end);
  return [...body.matchAll(/coalesce\(p_floor,\s*([0-9.]+)\)/g)].map((m) => m[1]);
}

describe('порог отбора плеч в экспрессах', () => {
  it('у сборки и у бэкфилла одинаковый', () => {
    expect(declaredFloor('build_model_accumulators'))
      .toBe(declaredFloor('backfill_model_accumulators'));
  });

  it('умолчание совпадает с coalesce внутри каждой функции', () => {
    for (const fn of ['build_model_accumulators', 'backfill_model_accumulators']) {
      const floors = coalesceFloors(fn);
      expect(floors.length, `${fn}: coalesce(p_floor, …) не найден`).toBeGreaterThan(0);
      for (const f of floors) expect(f, `${fn}: coalesce разошёлся с умолчанием`).toBe(declaredFloor(fn));
    }
  });

  it('тот же порог назван в комментарии на фронтенде', () => {
    // Экран объясняет игроку и следующему разработчику, по какому правилу
    // собран билет. Комментарий, отставший от SQL, врёт увереннее кода.
    const api = readFileSync('src/features/duel/forecastApi.ts', 'utf8');
    const m = /порог\s*\n?\/\/\s*([0-9.]+) по калиброванной вероятности/.exec(api);
    expect(m, 'в forecastApi.ts не найдено упоминание порога').not.toBeNull();
    expect(m![1]).toBe(declaredFloor('build_model_accumulators'));
  });
});
