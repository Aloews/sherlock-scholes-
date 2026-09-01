import { describe, it, expect } from 'vitest';
import {
  expectedPoints, rowIsConsistent, coverageIsEven, formOutcomes,
} from './leagueTable';
import type { LeagueTableRow } from './clubsApi';

const row = (over: Partial<LeagueTableRow> = {}): LeagueTableRow => ({
  place: 1, club_key: 'x', name: 'X', crest_url: null,
  played: 6, wins: 6, draws: 0, losses: 0,
  goals_for: 11, goals_against: 4, goal_diff: 7, points: 18, form: 'wwwww',
  ...over,
});

describe('expectedPoints', () => {
  it('победа три, ничья одно', () => {
    // Числа взяты из боевой таблицы РПЛ: Краснодар 6 побед = 18,
    // ЦСКА 3 победы + 3 ничьи = 12.
    expect(expectedPoints({ wins: 6, draws: 0 })).toBe(18);
    expect(expectedPoints({ wins: 3, draws: 3 })).toBe(12);
  });
});

describe('rowIsConsistent', () => {
  it('боевая строка сходится сама с собой', () => {
    expect(rowIsConsistent(row())).toBe(true);
    expect(rowIsConsistent(row({
      played: 6, wins: 3, draws: 3, losses: 0,
      goals_for: 9, goals_against: 6, goal_diff: 3, points: 12,
    }))).toBe(true);
  });

  it('ловит расхождение сыгранного с В+Н+П', () => {
    expect(rowIsConsistent(row({ played: 7 }))).toBe(false);
  });

  it('ловит неверные очки', () => {
    expect(rowIsConsistent(row({ points: 17 }))).toBe(false);
  });

  it('ловит неверную разницу мячей', () => {
    expect(rowIsConsistent(row({ goal_diff: 8 }))).toBe(false);
  });
});

describe('coverageIsEven', () => {
  it('начало сезона: у всех мало, но одинаково мало', () => {
    // АПЛ на 31.08.2026: у команд 1–2 матча. Это не потери сбора.
    expect(coverageIsEven([row({ played: 1 }), row({ played: 2 })])).toBe(true);
  });

  it('РПЛ 5–6 матчей — ровно', () => {
    expect(coverageIsEven([row({ played: 5 }), row({ played: 6 })])).toBe(true);
  });

  it('у одних шесть, у других один — это уже не сезон, а дыра', () => {
    expect(coverageIsEven([row({ played: 6 }), row({ played: 1 })])).toBe(false);
  });

  it('пустая таблица не объявляется неровной', () => {
    expect(coverageIsEven([])).toBe(true);
  });
});

describe('formOutcomes', () => {
  it('разбирает исходы', () => {
    expect(formOutcomes('wwlwd')).toEqual(['w', 'w', 'l', 'w', 'd']);
  });

  it('пусто — пустая форма, а не выдуманная', () => {
    expect(formOutcomes(null)).toEqual([]);
    expect(formOutcomes('')).toEqual([]);
  });

  it('чужие символы не пролезают', () => {
    expect(formOutcomes('wxz')).toEqual(['w']);
  });
});
