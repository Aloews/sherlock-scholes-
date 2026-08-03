import { describe, it, expect } from 'vitest';
import { splitHonours } from './honours';

// The dossier showed «ЧМ» under "Трофеи" for players who merely played at a
// World Cup. That is a factual claim about a real person, so the rule that
// separates the two is asserted here rather than left to a component.

describe('splitHonours', () => {
  it('never files a tournament appearance as a trophy', () => {
    const { trophies, tournaments } = splitHonours({
      titles: ['Лига чемпионов'],
      tournaments: ['ЧМ-2018', 'ЧЕ-2020'],
    });

    expect(trophies).toEqual(['Лига чемпионов']);
    expect(tournaments).toEqual(['ЧМ-2018', 'ЧЕ-2020']);
    expect(trophies).not.toContain('ЧМ-2018');
  });

  it('merges both title sources, legends included', () => {
    const { trophies } = splitHonours({
      titles: ['Золотой мяч'],
      legendTitles: ['ЧМ-1970'],
    });

    expect(trophies).toEqual(['Золотой мяч', 'ЧМ-1970']);
  });

  it('does not list a competition twice when it was entered and won', () => {
    // Winning it makes it a trophy; repeating it under tournaments would read
    // as two separate achievements.
    const { trophies, tournaments } = splitHonours({
      titles: ['ЧМ-1970'],
      tournaments: ['ЧМ-1970', 'ЧМ-1966'],
    });

    expect(trophies).toEqual(['ЧМ-1970']);
    expect(tournaments).toEqual(['ЧМ-1966']);
  });

  it('dedupes within each list', () => {
    const { trophies, tournaments } = splitHonours({
      titles: ['Лига чемпионов'],
      legendTitles: ['Лига чемпионов'],
      tournaments: ['ЧМ-2018', 'ЧМ-2018'],
    });

    expect(trophies).toEqual(['Лига чемпионов']);
    expect(tournaments).toEqual(['ЧМ-2018']);
  });

  it('survives missing, null and blank entries', () => {
    expect(splitHonours({})).toEqual({ trophies: [], tournaments: [] });
    expect(splitHonours({ titles: null, tournaments: null }))
      .toEqual({ trophies: [], tournaments: [] });
    expect(splitHonours({ titles: ['', '  ', 'ЧЕ'] }).trophies).toEqual(['ЧЕ']);
  });
});
