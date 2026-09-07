import { describe, expect, it } from 'vitest';
import { careerHighlight, type CareerTotals } from './careerHighlight';

const totals = (o: Partial<CareerTotals> = {}): CareerTotals => ({
  national_apps: 0, national_goals: 0, national_team: null,
  leagues: 0, countries: 0, ...o,
});

describe('careerHighlight', () => {
  it('сборная — первой: она говорит о человеке больше всего', () => {
    expect(careerHighlight(
      totals({ national_apps: 246, national_goals: 152, national_team: 'Portugal', leagues: 5 }),
      '1985-02-05',
    )).toEqual({ kind: 'national', team: 'Portugal', apps: 246, goals: 152 });
  });

  // ⚠️ Без имени команды «7 матчей за сборную» одинаково описывает Россию U17
  // и главную сборную Португалии — а это разные утверждения.
  it('без имени команды строка не собирается — уходим ниже по лестнице', () => {
    expect(careerHighlight(
      totals({ national_apps: 7, national_team: null, leagues: 7, countries: 4 }),
      '2000-05-29',
    )).toEqual({ kind: 'leagues', leagues: 7, countries: 4 });
  });

  it('ноль матчей за сборную — не сборная, даже если команда названа', () => {
    expect(careerHighlight(
      totals({ national_apps: 0, national_team: 'Portugal', leagues: 3, countries: 2 }),
      '1990-01-01',
    )).toEqual({ kind: 'leagues', leagues: 3, countries: 2 });
  });

  it('одна лига — не факт: «играл в 1 лиге» верно почти про каждого', () => {
    expect(careerHighlight(totals({ leagues: 1, countries: 1 }), '1999-02-11'))
      .toEqual({ kind: 'born', date: '1999-02-11' });
  });

  it('нет ничего, кроме даты рождения — показываем её', () => {
    expect(careerHighlight(totals(), '2002-10-18'))
      .toEqual({ kind: 'born', date: '2002-10-18' });
  });

  it('нет вообще ничего — строки нет, а не пустая строка', () => {
    expect(careerHighlight(totals(), null)).toBeNull();
    expect(careerHighlight(null, null)).toBeNull();
    expect(careerHighlight(undefined, undefined)).toBeNull();
  });

  it('статистики нет, но дата есть — дата', () => {
    expect(careerHighlight(null, '1998-06-10')).toEqual({ kind: 'born', date: '1998-06-10' });
  });

  it('пустые поля не роняют разбор', () => {
    expect(careerHighlight(
      { national_apps: null, national_goals: null, national_team: null,
        leagues: null, countries: null },
      null,
    )).toBeNull();
  });
});
