import { describe, expect, it } from 'vitest';
import { filterByQuery, foldForSearch, matchesQuery } from './facetSearch';

describe('foldForSearch', () => {
  it('снимает диакритику: «Atlético» находится по «atletico»', () => {
    expect(foldForSearch('Atlético')).toBe('atletico');
  });

  // ⚠️ ё и й — человек набирает как раскладка позволяет, а список обязан
  // находиться. Без этого «Кёльн» не найти по «келн».
  it('ё и й приводятся к е и и', () => {
    expect(foldForSearch('Кёльн')).toBe('кельн');
    expect(foldForSearch('Йокогама')).toBe('иокогама');
  });

  it('регистр и пробелы по краям не мешают', () => {
    expect(foldForSearch('  Реал Мадрид  ')).toBe('реал мадрид');
  });
});

describe('matchesQuery', () => {
  // ⚠️ ПУСТОЙ ЗАПРОС ВОЗВРАЩАЕТ ВСЁ: пока человек не набрал ничего, список
  // должен быть полным, а не пустым.
  it('пустой запрос подходит всему', () => {
    expect(matchesQuery('Ливерпуль', '')).toBe(true);
    expect(matchesQuery('Ливерпуль', '   ')).toBe(true);
  });

  it('находит по куску в середине', () => {
    expect(matchesQuery('Манчестер Сити', 'сити')).toBe(true);
  });

  it('не находит чужого', () => {
    expect(matchesQuery('Манчестер Сити', 'арсенал')).toBe(false);
  });

  it('«Атлетико» находится набором латиницей и наоборот', () => {
    expect(matchesQuery('Atlético Madrid', 'atletico')).toBe(true);
    expect(matchesQuery('Кёльн', 'кельн')).toBe(true);
  });
});

describe('filterByQuery', () => {
  const list = [
    { label: 'Англия. Премьер-лига' },
    { label: 'Испания. Ла Лига' },
    { label: 'Италия. Серия А' },
  ];

  it('пустой запрос — весь список', () => {
    expect(filterByQuery(list, '', (x) => x.label)).toHaveLength(3);
  });

  it('порядок сохраняется', () => {
    const got = filterByQuery(list, 'лига', (x) => x.label).map((x) => x.label);
    expect(got).toEqual(['Англия. Премьер-лига', 'Испания. Ла Лига']);
  });

  it('исходный список не меняется', () => {
    const src = list.slice();
    filterByQuery(src, 'лига', (x) => x.label);
    expect(src).toHaveLength(3);
  });

  it('ничего не найдено — пустой список, а не весь', () => {
    expect(filterByQuery(list, 'зимбабве', (x) => x.label)).toEqual([]);
  });
});
