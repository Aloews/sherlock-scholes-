import { describe, it, expect } from 'vitest';
import { swLine, swSides, swRatingTier, SW_LINES } from './soccerwikiPosition';

// Коды взяты с ЖИВЫХ строк 07.09.2026 — те, что реально встречаются в базе.
describe('swLine', () => {
  it('читает вратаря', () => {
    expect(swLine('Gk')).toBe('gk');
  });

  it('берёт ПЕРВЫЙ код, а не последний', () => {
    // ⚠️ ЭТО И ЕСТЬ ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА. Источник перечисляет позиции от
    // глубокой к передней; взяв последнюю, состав поставил бы левого
    // защитника (`D,DM,M(L)`) в полузащиту.
    expect(swLine('D,DM,M(L)')).toBe('def');
    expect(swLine('DM,M(C)')).toBe('mid');
    expect(swLine('AM(RL),F(RLC)')).toBe('mid');
    expect(swLine('F(C)')).toBe('fwd');
  });

  it('не путает D и DM', () => {
    expect(swLine('D(C)')).toBe('def');
    expect(swLine('DM,M,AM(C)')).toBe('mid');
  });

  it('неизвестный код — null, а не «полузащитник»', () => {
    // Тихая подстановка средней линии выглядела бы как настоящий состав.
    expect(swLine('Sweeper')).toBeNull();
    expect(swLine('')).toBeNull();
    expect(swLine(null)).toBeNull();
    expect(swLine(undefined)).toBeNull();
  });

  it('каждая линия из SW_LINES достижима', () => {
    const got = ['Gk', 'D(C)', 'M(C)', 'F(C)'].map(swLine);
    expect(got).toEqual(SW_LINES);
  });
});

describe('swSides', () => {
  it('вынимает стороны первой группы', () => {
    expect(swSides('AM(RL),F(RLC)')).toBe('RL');
    expect(swSides('D(C)')).toBe('C');
    expect(swSides('D,DM,M(L)')).toBe('');   // скобки у ПОСЛЕДНЕЙ группы
  });

  it('без скобок — пусто', () => {
    expect(swSides('Gk')).toBe('');
    expect(swSides(null)).toBe('');
  });
});

describe('swRatingTier', () => {
  it('лестница монотонна', () => {
    expect(swRatingTier(96)).toBe('icon');
    expect(swRatingTier(92)).toBe('icon');
    expect(swRatingTier(91)).toBe('legendary');
    expect(swRatingTier(85)).toBe('legendary');
    expect(swRatingTier(84)).toBe('epic');
    expect(swRatingTier(78)).toBe('epic');
    expect(swRatingTier(77)).toBe('rare');
    expect(swRatingTier(70)).toBe('rare');
    expect(swRatingTier(69)).toBe('common');
  });

  it('нет рейтинга — самая тихая ступень, а не верхняя', () => {
    expect(swRatingTier(null)).toBe('common');
    expect(swRatingTier(undefined)).toBe('common');
  });
});
