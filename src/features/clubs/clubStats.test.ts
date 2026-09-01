import { describe, it, expect } from 'vitest';
import {
  formFrom, goalDiff, pointsFrom, winRate, perMatch, hasEnoughForRates,
} from './clubStats';
import type { ClubMatchRow } from './clubsApi';

const m = (outcome: string | null, date = '2026-08-01'): ClubMatchRow => ({
  match_date: date, tournament: null, home: true,
  opponent_key: 'x', opponent: 'X',
  goals_for: 1, goals_against: 0, outcome,
});

describe('formFrom', () => {
  it('берёт пять последних, свежий слева', () => {
    const rows = [m('w'), m('d'), m('l'), m('w'), m('w'), m('l')];
    expect(formFrom(rows)).toEqual(['w', 'd', 'l', 'w', 'w']);
  });

  it('несыгранный матч пропускается, а не считается ничьёй', () => {
    // «Н» на месте матча без счёта испортила бы и форму, и доверие к ней.
    expect(formFrom([m(null), m('w'), m('l')])).toEqual(['w', 'l']);
  });

  it('пустой список даёт пустую форму, а не выдуманную', () => {
    expect(formFrom([])).toEqual([]);
  });
});

describe('goalDiff', () => {
  it('плюс печатается, минус приходит сам', () => {
    expect(goalDiff({ goals_for: 32, goals_against: 10 })).toBe('+22');
    expect(goalDiff({ goals_for: 10, goals_against: 32 })).toBe('-22');
  });

  it('ноль остаётся нулём без знака', () => {
    // «+0» читается как опечатка.
    expect(goalDiff({ goals_for: 7, goals_against: 7 })).toBe('0');
  });
});

describe('pointsFrom', () => {
  it('победа три, ничья одно', () => {
    expect(pointsFrom({ wins: 13, draws: 5 })).toBe(44);
    expect(pointsFrom({ wins: 0, draws: 0 })).toBe(0);
  });
});

describe('winRate', () => {
  it('считает целыми процентами', () => {
    expect(winRate({ wins: 13, matches: 20 })).toBe(65);
  });

  it('нет матчей — нет доли, а не ноль', () => {
    // «0% побед» — утверждение о команде; пустой список утверждать нечего.
    expect(winRate({ wins: 0, matches: 0 })).toBeNull();
  });
});

describe('perMatch', () => {
  it('один знак после запятой', () => {
    expect(perMatch(32, 20)).toBe('1.6');
  });

  it('нет матчей — null', () => {
    expect(perMatch(0, 0)).toBeNull();
  });
});

describe('hasEnoughForRates', () => {
  it('один матч не даёт права на проценты', () => {
    // Иначе команда с единственной победой — сильнейшая в мире, и убедительно.
    expect(hasEnoughForRates({ matches: 1 })).toBe(false);
    expect(hasEnoughForRates({ matches: 2 })).toBe(false);
  });

  it('с трёх — можно', () => {
    expect(hasEnoughForRates({ matches: 3 })).toBe(true);
  });
});
