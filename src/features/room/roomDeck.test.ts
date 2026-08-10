import { describe, it, expect } from 'vitest';
import {
  roomDeckFilter, pinnableFilter, settingsWithDeck, isWholeDeck,
} from './roomDeck';
import type { RoomSettings } from '@/shared/types/database';
import type { DeckFilter } from '@/shared/types/deck';

const base: RoomSettings = {
  round_seconds:   60,
  cards_per_round: 5,
  total_rounds:    3,
  categories:      null,
};

describe('roomDeckFilter', () => {
  it('deals the whole deck when nothing was ever chosen', () => {
    expect(roomDeckFilter(base)).toEqual({});
  });

  // The reason `deck` is optional rather than required: every room created
  // before this shipped has only `categories`, and those rooms must keep
  // dealing exactly what they dealt yesterday.
  it('falls back to categories for a room that predates the filter', () => {
    expect(roomDeckFilter({ ...base, categories: ['player', 'club'] }))
      .toEqual({ categories: ['club', 'player'] });
  });

  it('prefers the stored filter over the mirrored categories', () => {
    const settings: RoomSettings = {
      ...base,
      categories: ['player'],
      deck: { categories: ['player'], leagues: ['La Liga'], fame_min: 90 },
    };
    expect(roomDeckFilter(settings))
      .toEqual({ categories: ['player'], leagues: ['La Liga'], fame_min: 90 });
  });

  it('treats an explicitly null deck as no deck at all', () => {
    expect(roomDeckFilter({ ...base, categories: ['club'], deck: null }))
      .toEqual({ categories: ['club'] });
  });

  // A row rewritten by hand, or by a version that stored something else.
  // Falling back beats dealing from a string.
  it('ignores a stored deck that is not an object', () => {
    const settings = { ...base, categories: ['club'], deck: 'everything' } as unknown as RoomSettings;
    expect(roomDeckFilter(settings)).toEqual({ categories: ['club'] });
  });
});

describe('pinnableFilter', () => {
  // lang is one phone's interface language, and a room has several. Pinning it
  // would delete cards from everyone else's deck because of a setting they
  // cannot see.
  it('drops lang', () => {
    expect(pinnableFilter({ categories: ['player'], lang: 'ru' }))
      .toEqual({ categories: ['player'] });
  });

  it('keeps every other dimension', () => {
    const filter: DeckFilter = {
      categories: ['player'],
      continents: ['asia'],
      countries:  ['JP'],
      leagues:    ['Serie A'],
      tags:       ['goalkeeper'],
      clubs:      ['arsenal'],
      fame_min:   60,
    };
    expect(pinnableFilter(filter)).toEqual(filter);
  });

  it('drops empty arrays so an untouched dimension is absent, not []', () => {
    expect(pinnableFilter({ categories: ['player'], leagues: [], clubs: [] }))
      .toEqual({ categories: ['player'] });
  });

  it('leaves an empty category list alone — it means "nothing", not "all"', () => {
    // normalizeFilter drops `categories: []`, which is why the panel has its
    // own "nothing selected" check rather than relying on the stored shape.
    expect(pinnableFilter({ categories: [] })).toEqual({});
  });
});

describe('settingsWithDeck', () => {
  it('keeps the other room settings', () => {
    const out = settingsWithDeck(base, { categories: ['player'] });
    expect(out.round_seconds).toBe(60);
    expect(out.cards_per_round).toBe(5);
    expect(out.total_rounds).toBe(3);
  });

  // A build that predates `deck` reads `categories`, and any client in the
  // room may be the one that activates a round.
  it('mirrors categories for older frontends', () => {
    const out = settingsWithDeck(base, { categories: ['player', 'club'], leagues: ['La Liga'] });
    expect(out.categories).toEqual(['club', 'player']);
    expect(out.deck).toEqual({ categories: ['club', 'player'], leagues: ['La Liga'] });
  });

  it('mirrors "every category" as null, the way the column already meant it', () => {
    const out = settingsWithDeck({ ...base, categories: ['club'] }, { fame_min: 90 });
    expect(out.categories).toBeNull();
    expect(out.deck).toEqual({ fame_min: 90 });
  });

  it('stores nothing that pinnableFilter refuses', () => {
    const out = settingsWithDeck(base, { categories: ['player'], lang: 'ru' });
    expect(out.deck).toEqual({ categories: ['player'] });
  });

  // The round trip is what keeps the lobby's counter and the deal honest.
  it('round-trips through roomDeckFilter', () => {
    const filter: DeckFilter = { categories: ['player'], clubs: ['arsenal'], fame_min: 60 };
    expect(roomDeckFilter(settingsWithDeck(base, filter))).toEqual(filter);
  });
});

describe('isWholeDeck', () => {
  it('is true for an untouched filter', () => {
    expect(isWholeDeck({})).toBe(true);
    expect(isWholeDeck({ categories: null, leagues: [], fame_min: 0 })).toBe(true);
  });

  it('is false as soon as anything narrows it', () => {
    expect(isWholeDeck({ fame_min: 60 })).toBe(false);
    expect(isWholeDeck({ leagues: ['La Liga'] })).toBe(false);
    expect(isWholeDeck({ categories: ['player'] })).toBe(false);
  });
});
