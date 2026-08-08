// Onboarding difficulty: the two curves a new player is eased in by.
//
// fameFloor  — how obscure a card may be at all (cards.fame, one axis, MAX
//              across nine languages)
// langPool   — how deep the deal may reach into the ranking of the player's
//              OWN language (DeckFilter.lang_pool)
//
// They are not duplicates, and the test that says so is `beginner deck is
// language-aware, not just famous-somewhere` below: a card can clear any
// fame floor on the strength of one language and still be unguessable to
// this particular player. That is the whole reason langPool exists, so it
// is asserted rather than left to the comments.

import { describe, it, expect, vi } from 'vitest';

// The curves are pure, but the module they live in also owns the games-played
// counter, so importing it reaches Telegram storage and Supabase. Stubbed the
// way roomService.test.ts does it — the alternative is real credentials in a
// unit test of two arithmetic functions.
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/features/pro/proApi', () => ({ bumpGames: vi.fn() }));
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: vi.fn(() => ''),
  cloudGet: vi.fn(async () => null),
  cloudSet: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { fameFloor, fameStartLevel, langPool } from './onboarding';
// eslint-disable-next-line import/first
import { FAME_MIN } from '@/shared/types/deck';

const GRADUATED = 30; // games after which onboarding stops interfering

describe('fameFloor', () => {
  it('keeps the first games to household names', () => {
    expect(fameFloor(0)).toBe(85);
    expect(fameFloor(9)).toBe(85);
  });

  it('decays to nothing by the graduation game', () => {
    expect(fameFloor(GRADUATED)).toBe(0);
    expect(fameFloor(GRADUATED + 100)).toBe(0);
  });

  it('never rises as a player plays more', () => {
    for (let g = 1; g <= 40; g += 1) {
      expect(fameFloor(g)).toBeLessThanOrEqual(fameFloor(g - 1));
    }
  });
});

describe('langPool', () => {
  it('starts narrow, so a beginner only meets cards they can name', () => {
    expect(langPool(0)).toBe(120);
    expect(langPool(4)).toBe(120);
  });

  it('lifts the cap entirely once the player has graduated', () => {
    // 0 means "no pool" to the SQL side — NOT "a pool of zero cards", which
    // would deal an empty deck. deck_lang_pool.sql only accepts /^[1-9][0-9]*$/.
    expect(langPool(GRADUATED)).toBe(0);
    expect(langPool(GRADUATED + 50)).toBe(0);
  });

  it('only ever widens while the player is learning', () => {
    for (let g = 6; g < GRADUATED; g += 1) {
      expect(langPool(g)).toBeGreaterThanOrEqual(langPool(g - 1));
    }
  });

  it('is a real pool, never a negative or fractional card count', () => {
    for (let g = 0; g <= 40; g += 1) {
      const pool = langPool(g);
      expect(Number.isInteger(pool)).toBe(true);
      expect(pool).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays far wider than a hand, so rounds do not repeat', () => {
    // A quick game deals ~30. Dealing from a pool that size would hand out
    // nearly the same cards every time; the narrowest pool is still 4x that.
    const HAND = 30;
    for (let g = 0; g < GRADUATED; g += 1) {
      expect(langPool(g)).toBeGreaterThan(HAND * 3);
    }
  });
});

describe('the two curves together', () => {
  it('graduate on the same game, so difficulty ends in one step', () => {
    expect(fameFloor(GRADUATED)).toBe(0);
    expect(langPool(GRADUATED)).toBe(0);
    expect(fameFloor(GRADUATED - 1)).toBeGreaterThan(0);
    expect(langPool(GRADUATED - 1)).toBeGreaterThan(0);
  });

  it('beginner deck is language-aware, not just famous-somewhere', () => {
    // The floor is a threshold on cards.fame, which is a percentile of the
    // MAX across nine languages: «Зенит» sits at 84 on Russian views alone
    // and clears a floor of 0..84 for a Korean beginner who cannot guess it.
    // langPool is what makes the beginner deck depend on WHICH language, so
    // a new player must always carry one.
    for (let g = 0; g < GRADUATED; g += 1) {
      expect(langPool(g)).toBeGreaterThan(0);
    }
  });

  it('pre-selects a picker step that matches the floor', () => {
    expect(FAME_MIN[fameStartLevel(0)]).toBeLessThanOrEqual(fameFloor(0));
    expect(fameStartLevel(GRADUATED)).toBe('any');
  });
});
