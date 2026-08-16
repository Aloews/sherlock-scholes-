import { describe, it, expect } from 'vitest';
import { ageInDays, windowExceedsData, RATING_WINDOWS } from './freshness';

describe('ageInDays', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('считает полные сутки, а не календарные дни', () => {
    expect(ageInDays('2026-08-16T00:00:00Z', now)).toBe(0);
    expect(ageInDays('2026-08-15T00:00:00Z', now)).toBe(1);
    expect(ageInDays('2026-08-09T12:00:00Z', now)).toBe(7);
  });

  it('нет даты — нет возраста, а не ноль', () => {
    // Ноль означал бы «собрано только что», то есть самый успокаивающий из
    // возможных ответов там, где мы не знаем ничего.
    expect(ageInDays(null, now)).toBeNull();
    expect(ageInDays('не дата', now)).toBeNull();
  });

  it('дата из будущего не даёт отрицательного возраста', () => {
    // Часы телефона бывают сбиты; «−3 дня» на экране выглядит поломкой.
    expect(ageInDays('2026-08-19T00:00:00Z', now)).toBe(0);
  });
});

describe('windowExceedsData', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('годовое окно на данных с июля обещает больше, чем есть', () => {
    expect(windowExceedsData(365, '2026-07-01', now)).toBe(true);
  });

  it('недельное окно на тех же данных честно', () => {
    expect(windowExceedsData(7, '2026-07-01', now)).toBe(false);
  });

  it('данных нет вовсе — предупреждать не о чем', () => {
    // Здесь экран покажет «пусто», и подпись про неполноту только запутала бы.
    expect(windowExceedsData(365, null, now)).toBe(false);
  });

  it('данные старше окна — окно закрыто полностью', () => {
    expect(windowExceedsData(30, '2024-01-01', now)).toBe(false);
  });
});

describe('RATING_WINDOWS', () => {
  it('это неделя, месяц и год — те, что просил владелец', () => {
    expect(RATING_WINDOWS).toEqual([7, 30, 365]);
  });
});
