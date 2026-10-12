import { describe, expect, it } from 'vitest';
import { parseAIResolvedDeck } from './roomDeckIntent';

describe('AI room deck intent', () => {
  it('keeps exact IDs and infers every returned card category', () => {
    const result = parseAIResolvedDeck({
      title: 'Football mix',
      message: 'Ready',
      cards: [
        { id: 'coach-1', category: 'coach' },
        { id: 'stadium-1', category: 'stadium' },
        { id: 'player-1', category: 'player' },
        { id: 'ignored', category: 'not-a-category' },
      ],
    });

    expect(result).toEqual({
      filter: {
        categories: ['coach', 'stadium', 'player'],
        card_ids: ['coach-1', 'stadium-1', 'player-1'],
      },
      cardCount: 3,
      title: 'Football mix',
      message: 'Ready',
    });
  });

  it('deduplicates cards and caps the deck at twenty', () => {
    const cards = Array.from({ length: 25 }, (_, index) => ({
      id: `player-${index}`,
      category: 'player',
    }));
    cards.push({ id: 'player-0', category: 'player' });

    const result = parseAIResolvedDeck({ cards });

    expect(result?.cardCount).toBe(20);
    expect(result?.filter.card_ids).toHaveLength(20);
    expect(new Set(result?.filter.card_ids).size).toBe(20);
  });

  it('rejects malformed responses and decks with fewer than three valid cards', () => {
    expect(parseAIResolvedDeck(null)).toBeNull();
    expect(parseAIResolvedDeck({ cards: [] })).toBeNull();
    expect(parseAIResolvedDeck({ cards: [
      { id: 'one', category: 'player' },
      { id: 'two', category: 'player' },
      { id: 'bad', category: 'unknown' },
    ] })).toBeNull();
  });
});
