import { describe, it, expect } from 'vitest';
import { parseYears, compareCareer, byLatestFirst } from './careerOrder';

/**
 * Пример — С ЖИВОЙ КАРТОЧКИ, которую прислал владелец: Леон Классен, досье
 * показывало «Мюнхен 1860 2018–2021», «Тироль 2021–2021», «Спартак 2022–»
 * именно в таком порядке, то есть текущий клуб стоял последним.
 */
describe('parseYears', () => {
  it('разбирает закрытый период с длинным тире', () => {
    expect(parseYears('2018–2021')).toEqual({ start: 2018, end: 2021 });
  });

  it('разбирает короткий дефис так же', () => {
    expect(parseYears('2022-2023')).toEqual({ start: 2022, end: 2023 });
  });

  it('открытый конец — это «играет сейчас», а не один сезон', () => {
    expect(parseYears('2022–')).toEqual({ start: 2022, end: null });
  });

  it('один год без разделителя — один сезон', () => {
    expect(parseYears('2019')).toEqual({ start: 2019, end: 2019 });
  });

  it('без годов — нечего разбирать', () => {
    expect(parseYears('аренда')).toEqual({ start: null, end: null });
    expect(parseYears(null)).toEqual({ start: null, end: null });
  });
});

describe('byLatestFirst', () => {
  it('текущий клуб встаёт первым — та самая карточка владельца', () => {
    const rows = [
      { club: 'Мюнхен 1860', meta: '2018–2021' },
      { club: 'Тироль', meta: '2021–2021' },
      { club: 'Спартак', meta: '2022–' },
    ];
    expect(byLatestFirst(rows).map((r) => r.club))
      .toEqual(['Спартак', 'Тироль', 'Мюнхен 1860']);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: без сортировки по КОНЦУ периода этот случай
  // прошёл бы неверно. «2020–2026» длиннее и свежее, хотя начался раньше.
  it('ушедший позже выше начавшего позже', () => {
    const rows = [
      { club: 'Короткий', meta: '2022–2023' },
      { club: 'Длинный', meta: '2020–2026' },
    ];
    expect(byLatestFirst(rows).map((r) => r.club)).toEqual(['Длинный', 'Короткий']);
  });

  it('строка без годов уходит вниз, а не наверх', () => {
    const rows = [
      { club: 'Без годов', meta: '' },
      { club: 'С годами', meta: '2015–2016' },
    ];
    expect(byLatestFirst(rows).map((r) => r.club)).toEqual(['С годами', 'Без годов']);
  });

  it('исходный массив не трогается', () => {
    const rows = [{ club: 'A', meta: '2010–2011' }, { club: 'B', meta: '2020–' }];
    byLatestFirst(rows);
    expect(rows.map((r) => r.club)).toEqual(['A', 'B']);
  });

  it('равные периоды не переставляются', () => {
    expect(compareCareer('2020–2021', '2020–2021')).toBe(0);
  });
});
