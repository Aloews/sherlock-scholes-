import { describe, expect, it } from 'vitest';
import {
  filterSquadsByLeagues,
  reconcileSquadSelection,
} from './squadFilters';
import type { Squad } from './squads';

const squad = (key: string, name: string, league: string | null): Squad => ({
  key, name, league, players: 20, cardId: null, asOf: null,
});

describe('filterSquadsByLeagues', () => {
  const squads = [
    squad('barcelona', 'Barcelona', 'La Liga'),
    squad('chelsea', 'Chelsea', 'Premier League'),
    squad('arsenal', 'Arsenal', 'Premier League'),
    squad('other', 'Other FC', 'Other League'),
    squad('unassigned', 'Unassigned FC', null),
  ];

  it('filters by the union of selected leagues in canonical league order', () => {
    expect(filterSquadsByLeagues(squads, ['La Liga', 'Premier League']).map((s) => s.key))
      .toEqual(['arsenal', 'chelsea', 'barcelona']);
  });

  it('returns all leagues when none are selected and keeps unclassified squads last', () => {
    expect(filterSquadsByLeagues(squads, null).map((s) => s.key))
      .toEqual(['arsenal', 'chelsea', 'barcelona', 'other', 'unassigned']);
  });

  it('normalizes league casing and surrounding whitespace', () => {
    expect(filterSquadsByLeagues(squads, [' premier league ']).map((s) => s.key))
      .toEqual(['arsenal', 'chelsea']);
  });

  it('uses the canonical squad key as a deterministic final tie-break', () => {
    const tied = [squad('z-key', 'Same Name', 'Premier League'), squad('a-key', 'Same Name', 'Premier League')];
    expect(filterSquadsByLeagues(tied, ['Premier League']).map((s) => s.key))
      .toEqual(['a-key', 'z-key']);
  });
});

describe('reconcileSquadSelection', () => {
  it('preserves valid selected clubs and removes only unavailable ones', () => {
    const available = [squad('arsenal', 'Arsenal', 'Premier League'), squad('barcelona', 'Barcelona', 'La Liga')];
    expect(reconcileSquadSelection(['arsenal', 'missing', 'barcelona'], available))
      .toEqual(['arsenal', 'barcelona']);
  });

  it('removes duplicate selected keys without changing the surviving order', () => {
    const available = [squad('arsenal', 'Arsenal', 'Premier League')];
    expect(reconcileSquadSelection(['arsenal', 'arsenal'], available)).toEqual(['arsenal']);
  });
});
