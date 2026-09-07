import { describe, expect, it } from 'vitest';
import { formatMetric, movedMetrics } from './metricFormat';

const row = (o: Partial<Parameters<typeof movedMetrics>[0][number]> = {}) => ({
  metric: 'market_value', was: 100, now_value: 200, delta: 100, growth: 2, ...o,
});

describe('formatMetric', () => {
  it('пустое значение — прочерк, а не ноль: числа не было, а не «стоит нисколько»', () => {
    expect(formatMetric('market_value', null, 'ru')).toBe('—');
    expect(formatMetric('career_goals', undefined, 'ru')).toBe('—');
  });

  it('ноль показывается как ноль, а не как прочерк', () => {
    expect(formatMetric('career_goals', 0, 'en')).toBe('0');
  });

  it('стоимость — деньгами', () => {
    expect(formatMetric('market_value', 600000, 'en')).toMatch(/€/);
  });

  it('рейтинг — не деньгами, хотя тоже число', () => {
    expect(formatMetric('sw_rating', 78, 'en')).not.toMatch(/€/);
  });
});

describe('movedMetrics', () => {
  it('ПЕРВЫЙ ЗАМЕР НЕ ДИНАМИКА: было пусто — строки нет', () => {
    expect(movedMetrics([row({ was: null, delta: null, growth: null })])).toEqual([]);
  });

  it('исчезнувшее число тоже не динамика — сравнивать не с чем', () => {
    expect(movedMetrics([row({ now_value: null, delta: null, growth: null })])).toEqual([]);
  });

  it('нулевая разница выброшена: «100 → 100» ничего не сообщает', () => {
    expect(movedMetrics([row({ now_value: 100, delta: 0, growth: 1 })])).toEqual([]);
  });

  it('падение показывается наравне с ростом', () => {
    const got = movedMetrics([row({ now_value: 50, delta: -50, growth: 0.5 })]);
    expect(got).toHaveLength(1);
  });

  it('сверху — самое резкое изменение, а не самое большое число', () => {
    const got = movedMetrics([
      row({ metric: 'market_value', was: 1_000_000, now_value: 1_100_000,
            delta: 100_000, growth: 1.1 }),
      row({ metric: 'career_goals', was: 2, now_value: 8, delta: 6, growth: 4 }),
    ]);
    expect(got.map((r) => r.metric)).toEqual(['career_goals', 'market_value']);
  });

  it('исходный список не переставляется на месте', () => {
    const src = [
      row({ metric: 'a', was: 10, now_value: 11, delta: 1, growth: 1.1 }),
      row({ metric: 'b', was: 1, now_value: 4, delta: 3, growth: 4 }),
    ];
    movedMetrics(src);
    expect(src.map((r) => r.metric)).toEqual(['a', 'b']);
  });

  it('без growth порядок считается по доле от прежнего значения', () => {
    const got = movedMetrics([
      row({ metric: 'slow', was: 100, now_value: 110, delta: 10, growth: null }),
      row({ metric: 'fast', was: 10, now_value: 30, delta: 20, growth: null }),
    ]);
    expect(got.map((r) => r.metric)).toEqual(['fast', 'slow']);
  });
});
