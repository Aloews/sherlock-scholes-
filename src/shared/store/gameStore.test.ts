import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGameStore } from './gameStore';
import type { RoundCard } from '@/shared/types/database';

// Scoring & card bookkeeping in the game store. updateCard is the write path a
// live round drives on every correct/skip tap, so its correctness — and its
// no-op on an unknown id — is load-bearing.

const card = (id: string): RoundCard =>
  ({ id, status: 'pending', decided_at: null }) as unknown as RoundCard;

beforeEach(() => {
  useGameStore.getState().reset();
  useGameStore.setState({ currentCards: [card('a'), card('b'), card('c')] });
});

describe('gameStore.updateCard', () => {
  it('marks a card correct and stamps decided_at', () => {
    useGameStore.getState().updateCard('b', 'correct');
    const b = useGameStore.getState().currentCards.find((c) => c.id === 'b')!;
    expect(b.status).toBe('correct');
    expect(b.decided_at).toBeTruthy();
    expect(() => new Date(b.decided_at as string).toISOString()).not.toThrow();
  });

  it('marks a card skipped', () => {
    useGameStore.getState().updateCard('a', 'skipped');
    expect(useGameStore.getState().currentCards.find((c) => c.id === 'a')!.status).toBe('skipped');
  });

  it('only touches the targeted card', () => {
    useGameStore.getState().updateCard('b', 'correct');
    const others = useGameStore.getState().currentCards.filter((c) => c.id !== 'b');
    expect(others.every((c) => c.status === 'pending' && c.decided_at === null)).toBe(true);
  });

  it('is a no-op for an unknown card id (no throw, no mutation)', () => {
    const before = JSON.stringify(useGameStore.getState().currentCards);
    expect(() => useGameStore.getState().updateCard('zzz', 'correct')).not.toThrow();
    expect(JSON.stringify(useGameStore.getState().currentCards)).toBe(before);
  });

  it('reflects the latest status when a card is decided twice', () => {
    useGameStore.getState().updateCard('c', 'correct');
    useGameStore.getState().updateCard('c', 'skipped');
    expect(useGameStore.getState().currentCards.find((c) => c.id === 'c')!.status).toBe('skipped');
  });
});

describe('gameStore setters', () => {
  it('setActiveCardIndex updates the pointer', () => {
    useGameStore.getState().setActiveCardIndex(2);
    expect(useGameStore.getState().activeCardIndex).toBe(2);
  });

  it('setError / setLoading / setCountdown store their values', () => {
    useGameStore.getState().setError('boom');
    useGameStore.getState().setLoading(true);
    useGameStore.getState().setCountdown(1);
    const s = useGameStore.getState();
    expect([s.error, s.loading, s.countdown]).toEqual(['boom', true, 1]);
  });
});

describe('gameStore.reset', () => {
  it('restores initial state (idle, empty cards, no error)', () => {
    useGameStore.getState().setError('x');
    useGameStore.getState().setActiveCardIndex(2);
    useGameStore.getState().reset();
    const s = useGameStore.getState();
    expect(s.phase).toBe('idle');
    expect(s.currentCards).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.activeCardIndex).toBe(0);
  });
});
