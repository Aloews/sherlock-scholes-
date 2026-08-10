import { describe, it, expect, vi } from 'vitest';

// The functions under test are pure, but they live beside the panel that uses
// them, and the panel reaches the squad list. Stubbed so importing the module
// does not need a configured Supabase client.
vi.mock('@/shared/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { fameLevelOf, readCategories, writeCategories } from './RoomDeckPanel';
import { FAME_MIN, NON_PLAYER_CATEGORIES } from '@/shared/types/deck';
import type { CardCategory } from '@/shared/types/database';

// The two controls in the lobby — a players toggle and three group counters —
// have to describe the same thing the stored filter does, in both directions.
// The trap is `null`: in a DeckFilter an absent `categories` means EVERY
// category, and reading it as "none selected" would show the host an empty
// panel above a full deck.

describe('readCategories', () => {
  it('reads an absent category list as everything on', () => {
    const { players, others } = readCategories({});
    expect(players).toBe(true);
    expect(others.size).toBe(NON_PLAYER_CATEGORIES.length);
  });

  it('reads null the same way', () => {
    expect(readCategories({ categories: null }).players).toBe(true);
  });

  it('reads a players-only filter', () => {
    const { players, others } = readCategories({ categories: ['player'] });
    expect(players).toBe(true);
    expect(others.size).toBe(0);
  });

  it('reads a filter with no players in it', () => {
    const { players, others } = readCategories({ categories: ['club', 'stadium'] });
    expect(players).toBe(false);
    expect([...others].sort()).toEqual(['club', 'stadium']);
  });

  it('ignores a category that is not one of the groups', () => {
    // 'player' is handled by its own toggle, never by the group chips.
    expect(readCategories({ categories: ['player', 'club'] }).others.has('player' as CardCategory))
      .toBe(false);
  });
});

describe('writeCategories', () => {
  // Storing the enumerated list would deal identically today and stop dealing
  // a new category the day one is added to the game.
  it('writes "everything" as null rather than as the full list', () => {
    expect(writeCategories(true, new Set(NON_PLAYER_CATEGORIES))).toBeNull();
  });

  it('writes players alone', () => {
    expect(writeCategories(true, new Set())).toEqual(['player']);
  });

  it('writes a partial selection with players first', () => {
    const out = writeCategories(true, new Set(['club'] as CardCategory[]));
    expect(out).toEqual(['player', 'club']);
  });

  it('writes an empty list when nothing at all is selected', () => {
    // Not null: "nothing" and "everything" are opposite decks, and the panel
    // shows the empty warning off exactly this.
    expect(writeCategories(false, new Set())).toEqual([]);
  });

  it('round-trips every state the controls can be in', () => {
    const states: [boolean, CardCategory[]][] = [
      [true,  [...NON_PLAYER_CATEGORIES]],
      [true,  []],
      [false, ['club', 'stadium'] as CardCategory[]],
      [true,  ['trophy'] as CardCategory[]],
    ];
    for (const [players, others] of states) {
      const stored = writeCategories(players, new Set(others));
      const read = readCategories({ categories: stored });
      expect(read.players).toBe(players);
      expect([...read.others].sort()).toEqual([...others].sort());
    }
  });
});

describe('fameLevelOf', () => {
  it('maps each step back to itself', () => {
    expect(fameLevelOf(FAME_MIN.any)).toBe('any');
    expect(fameLevelOf(FAME_MIN.known)).toBe('known');
    expect(fameLevelOf(FAME_MIN.famous)).toBe('famous');
  });

  it('treats an absent floor as the whole deck', () => {
    expect(fameLevelOf(null)).toBe('any');
    expect(fameLevelOf(undefined)).toBe('any');
  });

  // A floor between two steps — from a preset, or from a hand-edited row.
  // Rounding down keeps the label from promising a stricter deck than the one
  // that will be dealt.
  it('rounds a floor between steps down', () => {
    expect(fameLevelOf(FAME_MIN.known - 1)).toBe('any');
    expect(fameLevelOf(FAME_MIN.famous - 1)).toBe('known');
    expect(fameLevelOf(100)).toBe('famous');
  });
});
