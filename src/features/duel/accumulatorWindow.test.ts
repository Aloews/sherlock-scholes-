import { describe, it, expect, vi } from 'vitest';
import {
  resolveAccumulatorWindow, windowLabel, WINDOW_HOURS,
} from './accumulatorWindow';

/**
 * ⚠️ ЭТОТ ТЕСТ СТЕРЕЖЁТ ЖИВУЮ ЖАЛОБУ, А НЕ ФУНКЦИЮ.
 *
 * Панель экспресса была прибита к 72 часам и на пустом окне писала «понизьте
 * порог». В день, когда у клубных лиг перерыв на сборные, это враньё: матчей
 * с котировками в окне НЕТ ВООБЩЕ, и понижать порог бесполезно. Поэтому
 * проверяется не «функция возвращает объект», а четыре РАЗНЫХ исхода и то,
 * что их не путают между собой.
 */

type Leg = { fair_prob: number };

const leg = (p: number): Leg => ({ fair_prob: p });

describe('окно отбора экспресса', () => {
  it('нашлось в запрошенном окне — шире не ходит', async () => {
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[]> => [leg(0.7)]);
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'rows', hours: 72, rows: [leg(0.7)] });
    // Ровно один запрос: лишнее расширение стоило бы трёх запросов на ровном месте.
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(72, 0.6);
  });

  it('пусто близко, нашлось далеко — расширяет и СООБЩАЕТ, в каком окне нашёл', async () => {
    // Ровно то, что было на бою 21.09.2026: до 9 октября котировок нет.
    const load = vi.fn(async (hours: number, _p: number): Promise<Leg[]> =>
      (hours === 720 ? [leg(0.9)] : []));
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'rows', hours: 720, rows: [leg(0.9)] });
    expect(load.mock.calls.map((c) => c[0])).toEqual([72, 168, 336, 720]);
  });

  it('матчи есть, но все ниже порога — виноват ПОРОГ, и видно лучший', async () => {
    const load = vi.fn(async (_hours: number, minProb: number): Promise<Leg[]> =>
      (minProb === 0 ? [leg(0.41), leg(0.52), leg(0.38)] : []));
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'floor', hours: 720, best: 0.52 });
  });

  it('матчей с котировками нет вовсе — виновато ОКНО, про порог молчим', async () => {
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[]> => []);
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'window', hours: 720 });
    // Четыре окна плюс зонд с нулевым порогом — и ни одним запросом больше.
    expect(load).toHaveBeenCalledTimes(WINDOW_HOURS.length + 1);
    expect(load).toHaveBeenLastCalledWith(720, 0);
  });

  it('ошибка запроса — это НЕ пустота: расширять нечего, дальше не ходим', async () => {
    // Пустота это ответ «в окне ничего нет». Ошибка — «не спросили», и
    // расширение окна на ней даёт четыре одинаковые ошибки подряд, а на экране
    // «матчей нет» вместо «не удалось загрузить».
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[] | null> => null);
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'error' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('запрошенное окно — нижняя граница: уже него не спрашивает никогда', async () => {
    // «Покажи за месяц» не должно молча показать за три дня.
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[]> => []);
    await resolveAccumulatorWindow(336, 0.6, load);

    const asked = load.mock.calls.map((c) => c[0]);
    expect(asked.every((h) => h >= 336)).toBe(true);
    expect(asked).toEqual([336, 720, 720]);
  });

  it('у каждого окна есть человеческая подпись, а не число часов', async () => {
    for (const h of WINDOW_HOURS) {
      expect(windowLabel(h)).not.toMatch(/^\d+ ч$/);
    }
    // Незнакомое окно всё равно читается, а не рисуется пустотой.
    expect(windowLabel(999)).toBe('999 ч');
  });
});
