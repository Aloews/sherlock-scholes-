import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import type { Card, CardCategory } from '@/shared/types/database';

const BATCH       = 50;
const PRELOAD_AT  = 10; // fetch next batch when this many cards remain

export type Team = 'orange' | 'blue';

export interface HistoryEntry {
  name: string;
  category: CardCategory;
  status: 'guessed' | 'skipped';
}

/**
 * Quick Game — one phone, two teams, running score, no timer, no end.
 * Cards are loaded in batches (no DB persistence, no repeats within a session),
 * exactly like the old training mode.
 */
export function useTraining(categories: CardCategory[] | null) {
  const [cards,   setCards]   = useState<Card[]>([]);
  const [index,   setIndex]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [scores,  setScores]  = useState<Record<Team, number>>({ orange: 0, blue: 0 });
  const [activeTeam, setActiveTeam] = useState<Team>('orange');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const isPreloadingRef = useRef(false);

  // Initial load
  useEffect(() => {
    pickRandomCards(BATCH, categories)
      .then((batch) => setCards(batch))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [categories]);

  // Preload next batch silently
  const preloadMore = useCallback(() => {
    if (isPreloadingRef.current) return;
    isPreloadingRef.current = true;
    pickRandomCards(BATCH, categories)
      .then((batch) => setCards((prev) => [...prev, ...batch]))
      .catch(() => undefined)
      .finally(() => { isPreloadingRef.current = false; });
  }, [categories]);

  const advance = useCallback(() => {
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= cards.length - PRELOAD_AT) preloadMore();
      return next;
    });
  }, [cards.length, preloadMore]);

  // Append the current card to the in-memory history
  const recordCurrent = useCallback((status: HistoryEntry['status']) => {
    const card = cards[index];
    if (!card) return;
    setHistory((prev) => [...prev, { name: card.name, category: card.category, status }]);
  }, [cards, index]);

  // +1 to active team, show next card
  const guess = useCallback(() => {
    recordCurrent('guessed');
    setScores((prev) => ({ ...prev, [activeTeam]: prev[activeTeam] + 1 }));
    advance();
  }, [activeTeam, advance, recordCurrent]);

  // Next card, no point
  const skip = useCallback(() => {
    recordCurrent('skipped');
    advance();
  }, [advance, recordCurrent]);

  // Switch active team and move to the next card (current card goes unsolved)
  const passTurn = useCallback(() => {
    recordCurrent('skipped');
    setActiveTeam((prev) => (prev === 'orange' ? 'blue' : 'orange'));
    advance();
  }, [advance, recordCurrent]);

  return {
    currentCard: cards[index] ?? null,
    loading,
    scores,
    activeTeam,
    history,
    guess,
    skip,
    passTurn,
  };
}
