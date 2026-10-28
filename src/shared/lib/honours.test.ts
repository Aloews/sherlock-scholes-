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

  it('shows refreshed honours stored by the automatic source sync', () => {
    const result = splitHonours({
      honours: [
        { title: 'Обладатель «Золотого мяча» по версии France Football', count: 1, kind: 'personal' },
        { title: 'Трофей Герда Мюллера', count: 1, kind: 'personal' },
      ],
      tournaments: ['ЧМ-2026'],
    });

    expect(result.trophies).toEqual(['Золотой мяч', 'Трофей Герда Мюллера']);
    expect(result.tournaments).toEqual(['ЧМ-2026']);
  });

  it('merges the latest award count with legacy title strings without duplicates', () => {
    const result = splitHonours({
      titles: ['Золотой мяч ×2'],
      honours: [
        { title: 'Обладатель «Золотого мяча» по версии France Football', count: 3, kind: 'personal' },
      ],
    });

    expect(result.trophies).toEqual(['Золотой мяч ×3']);
  });

  it('combines Messi-era France Football and FIFA Ballon d’Or counts into eight', () => {
    const result = splitHonours({
      titles: ['Золотой мяч ×4'],
      honours: [
        { title: 'Обладатель «Золотого мяча» по версии France Football', count: 4, kind: 'personal' },
        { title: 'Обладатель «Золотого мяча ФИФА»', count: 4, kind: 'personal' },
      ],
    });
    expect(result.trophies).toEqual(['Золотой мяч ×8']);
  });

  it('does not show an award twice when its source uses a longer label', () => {
    const result = splitHonours({
      titles: ['Золотой мяч ×1'],
      honours: [
        { title: 'Обладатель «Золотого мяча» по версии France Football', count: 1, kind: 'personal' },
      ],
    });

    expect(result.trophies).toEqual(['Золотой мяч']);
  });

  it('keeps the newly won year-specific Ballon d’Or visible', () => {
    const result = splitHonours({
      titles: ['Золотой мяч 2026'],
      honours: [
        { title: 'Обладатель «Золотого мяча» по версии France Football', count: 1, kind: 'personal' },
      ],
    });

    expect(result.trophies).toEqual(['Золотой мяч 2026']);
  });

  it('does not merge the Club World Cup Golden Ball into the Ballon d’Or', () => {
    const result = splitHonours({
      titles: ['Золотой мяч'],
      honours: [
        { title: 'Обладатель «Золотого мяча» Клубного чемпионата мира', count: 1, kind: 'personal' },
      ],
    });

    expect(result.trophies).toEqual([
      'Золотой мяч',
      'Золотой мяч клубного чемпионата мира',
    ]);
  });

  it('survives missing, null and blank entries', () => {
    expect(splitHonours({})).toEqual({ trophies: [], tournaments: [] });
    expect(splitHonours({ titles: null, tournaments: null }))
      .toEqual({ trophies: [], tournaments: [] });
    expect(splitHonours({ titles: ['', '  ', 'ЧЕ'] }).trophies).toEqual(['ЧЕ']);
  });
});
