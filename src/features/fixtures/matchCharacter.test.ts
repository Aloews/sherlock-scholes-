import { describe, it, expect } from 'vitest';
import {
  characterBands, characterMatches,
  GOALS_LOW, GOALS_HIGH, FLOW_CLOSED, FLOW_OPEN,
} from './matchCharacter';

describe('characterBands', () => {
  // ⚠️ ГЛАВНОЕ, РАДИ ЧЕГО ЭТОТ ФАЙЛ. Характера нет у большинства клубов, и
  // подставить «среднее по умолчанию» — самая дешёвая из возможных правок и
  // самая незаметная ложь: экран покажет «сбалансированный» там, где мы просто
  // ничего не знаем.
  it('без чисел не выдумывает полосу', () => {
    expect(characterBands(null, 50)).toBeNull();
    expect(characterBands(3.0, null)).toBeNull();
    expect(characterBands(undefined, undefined)).toBeNull();
  });

  // Ноль — это измеренный ноль, а не отсутствие: команда, которая не забивает
  // и не пропускает, существует, и полоса у неё «мало голов».
  it('ноль считает измерением, а не пустотой', () => {
    expect(characterBands(0, 0)).toEqual({ goals: 'low', flow: 'closed' });
  });

  it('делит голы по измеренным порогам', () => {
    expect(characterBands(GOALS_LOW - 0.1, 50)?.goals).toBe('low');
    expect(characterBands(GOALS_LOW, 50)?.goals).toBe('mid');
    expect(characterBands(GOALS_HIGH - 0.1, 50)?.goals).toBe('mid');
    expect(characterBands(GOALS_HIGH, 50)?.goals).toBe('high');
  });

  it('делит течение игры по измеренным порогам', () => {
    expect(characterBands(3, FLOW_CLOSED - 1)?.flow).toBe('closed');
    expect(characterBands(3, FLOW_CLOSED)?.flow).toBe('balanced');
    expect(characterBands(3, FLOW_OPEN - 1)?.flow).toBe('balanced');
    expect(characterBands(3, FLOW_OPEN)?.flow).toBe('open');
  });

  // Замер 09.09.2026 по 18 ближайшим матчам: медиана голов 3.00, открытости 57.
  // Обе обязаны попасть в СРЕДНЮЮ полосу — иначе половина матчей называлась бы
  // крайностью и слово перестало бы что-либо значить.
  it('медиана живых данных попадает в середину, а не в край', () => {
    expect(characterBands(3.0, 57)).toEqual({ goals: 'mid', flow: 'balanced' });
  });

  // Живые крайности того же замера: 2.40/15 и 4.10/97.
  it('крайности живых данных попадают в края', () => {
    expect(characterBands(2.4, 15)).toEqual({ goals: 'low', flow: 'closed' });
    expect(characterBands(4.1, 97)).toEqual({ goals: 'high', flow: 'open' });
  });
});

describe('characterMatches', () => {
  // Утверждение о матче не может быть надёжнее знания о худшей его стороне.
  it('берёт меньшее из двух, а не сумму и не среднее', () => {
    expect(characterMatches(74, 12)).toBe(12);
    expect(characterMatches(12, 74)).toBe(12);
  });

  it('без одной из сторон не отвечает', () => {
    expect(characterMatches(74, null)).toBeNull();
    expect(characterMatches(null, 74)).toBeNull();
  });
});
