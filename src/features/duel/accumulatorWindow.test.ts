import { describe, it, expect, vi } from 'vitest';
import {
  resolveAccumulatorWindow, nearestWindowWith, windowLabel, WINDOW_HOURS,
} from './accumulatorWindow';

/**
 * ⚠️ ЭТОТ ТЕСТ СТЕРЕЖЁТ ДВЕ ЖИВЫЕ ЖАЛОБЫ ПО ОДНОМУ МЕСТУ, А НЕ ФУНКЦИЮ.
 *
 * Первая: панель была прибита к 72 часам и на пустом окне писала «понизьте
 * порог» — в день перерыва сборных это враньё, матчей с ценой в окне нет
 * вообще и понижать порог бесполезно.
 *
 * Вторая: починка первой ввела саморасширение окна, и стало хуже. Матчи есть
 * только в «месяце», поэтому любой выбор молча превращался в месяц — «выбрал
 * недельный прогноз и месячный, он никак не поменялся». Поэтому здесь прямо
 * проверяется, что соседние окна НЕ спрашиваются: подмена выбора это дефект,
 * а не удобство.
 */

type Leg = { fair_prob: number };

const leg = (p: number): Leg => ({ fair_prob: p });

describe('окно отбора экспресса', () => {
  it('спрашивает РОВНО выбранное окно и отдаёт его ноги', async () => {
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[]> => [leg(0.7)]);
    const got = await resolveAccumulatorWindow(168, 0.6, load);

    expect(got).toEqual({ kind: 'rows', rows: [leg(0.7)] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(168, 0.6);
  });

  it('пусто в выбранном окне — соседние НЕ спрашивает', async () => {
    // Ровно вторая жалоба: «неделя» и «месяц» давали один и тот же список,
    // потому что панель сама уходила в месяц. Больше не уходит.
    const load = vi.fn(async (hours: number): Promise<Leg[]> =>
      (hours === 720 ? [leg(0.9)] : []));
    const got = await resolveAccumulatorWindow(168, 0.6, load);

    expect(got).toEqual({ kind: 'window' });
    expect(load.mock.calls.map((c) => c[0])).toEqual([168, 168]);
  });

  it('матчи есть, но все ниже порога — виноват ПОРОГ, и видно лучший', async () => {
    const load = vi.fn(async (_hours: number, minProb: number): Promise<Leg[]> =>
      (minProb === 0 ? [leg(0.41), leg(0.52), leg(0.38)] : []));
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'floor', best: 0.52 });
  });

  it('матчей с котировками нет вовсе — виновато ОКНО, про порог молчим', async () => {
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[]> => []);
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'window' });
    // Один запрос по порогу и один зонд с нулевым — и ни одним больше.
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(72, 0);
  });

  it('ошибка запроса — это НЕ пустота: объяснять нечего, зонд не шлём', async () => {
    const load = vi.fn(async (_h: number, _p: number): Promise<Leg[] | null> => null);
    const got = await resolveAccumulatorWindow(72, 0.6, load);

    expect(got).toEqual({ kind: 'error' });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('подсказка следующего окна', () => {
  // Живые числа 21.09.2026: матчи с ценой есть только в месяце.
  const counts = { 72: 0, 168: 0, 336: 0, 720: 77 };

  it('из пустого окна ведёт в ближайшее непустое', () => {
    expect(nearestWindowWith(counts, 72)).toBe(720);
    expect(nearestWindowWith(counts, 336)).toBe(720);
  });

  it('из самого широкого вести некуда', () => {
    expect(nearestWindowWith(counts, 720)).toBeNull();
  });

  it('когда пусто везде — подсказки нет, а не выдуманное окно', () => {
    expect(nearestWindowWith({ 72: 0, 168: 0, 336: 0, 720: 0 }, 72)).toBeNull();
  });

  it('ближайшее — именно ближайшее, а не самое широкое', () => {
    expect(nearestWindowWith({ 72: 0, 168: 4, 336: 9, 720: 77 }, 72)).toBe(168);
  });
});

describe('подписи окон', () => {
  it('у каждого окна человеческая подпись, а не число часов', () => {
    for (const h of WINDOW_HOURS) {
      expect(windowLabel(h)).not.toMatch(/^\d+ ч$/);
    }
    // Незнакомое окно всё равно читается, а не рисуется пустотой.
    expect(windowLabel(999)).toBe('999 ч');
  });
});
