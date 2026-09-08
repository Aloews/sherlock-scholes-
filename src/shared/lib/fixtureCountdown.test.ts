import { describe, it, expect } from 'vitest';
import { fixtureCountdown, ALERT_MINUTES } from './fixtureCountdown';

describe('fixtureCountdown', () => {
  it('полчаса и меньше — анонс трансляции', () => {
    // Ради этой ветки всё и делалось: на неё можно успеть включить.
    expect(fixtureCountdown(30)).toEqual({ kind: 'alert', minutes: 30 });
    expect(fixtureCountdown(1)).toEqual({ kind: 'alert', minutes: 1 });
    expect(fixtureCountdown(29.4)).toEqual({ kind: 'alert', minutes: 29 });
  });

  it('минута после порога — уже часы, а не анонс', () => {
    expect(fixtureCountdown(ALERT_MINUTES + 1).kind).toBe('hours');
  });

  it('часы — пока они читаются как часы', () => {
    expect(fixtureCountdown(120)).toEqual({ kind: 'hours', hours: 2 });
    expect(fixtureCountdown(885)).toEqual({ kind: 'hours', hours: 15 });
    // 23 ч 40 мин округляются до 24, но это ещё «часы»: сутки не наступили.
    expect(fixtureCountdown(23 * 60 + 40).kind).toBe('hours');
  });

  it('сутки и дальше — дата, а не «через 240 часов»', () => {
    expect(fixtureCountdown(24 * 60)).toEqual({ kind: 'date' });
    expect(fixtureCountdown(10 * 24 * 60)).toEqual({ kind: 'date' });
  });

  it('ноль и минус — матч уже идёт', () => {
    // ⚠️ Между запросом и отрисовкой проходит время; «через −3 минуты» — ложь.
    expect(fixtureCountdown(0)).toEqual({ kind: 'live' });
    expect(fixtureCountdown(-3)).toEqual({ kind: 'live' });
  });

  it('нет числа — нет обратного отсчёта, остаётся дата', () => {
    expect(fixtureCountdown(null)).toEqual({ kind: 'date' });
    expect(fixtureCountdown(undefined)).toEqual({ kind: 'date' });
    expect(fixtureCountdown(Number.NaN)).toEqual({ kind: 'date' });
  });

  it('порог настраиваемый, и час до начала при нём — анонс', () => {
    expect(fixtureCountdown(45, 60)).toEqual({ kind: 'alert', minutes: 45 });
  });

  it('округление минут не даёт нуля: «через 0 минут» — не текст', () => {
    expect(fixtureCountdown(0.4)).toEqual({ kind: 'alert', minutes: 1 });
  });
});
