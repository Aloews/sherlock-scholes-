import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import type { Card, CardCategory } from '@/shared/types/database';

const BATCH       = 50;
const PRELOAD_AT  = 10; // fetch next batch when this many cards remain

export type Team = 'orange' | 'blue';

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

  // +1 to active team, show next card
  const guess = useCallback(() => {
    setScores((prev) => ({ ...prev, [activeTeam]: prev[activeTeam] + 1 }));
    advance();
  }, [activeTeam, advance]);

  // Next card, no point
  const skip = useCallback(() => {
    advance();
  }, [advance]);

  // Switch active team and move to the next card
  const passTurn = useCallback(() => {
    setActiveTeam((prev) => (prev === 'orange' ? 'blue' : 'orange'));
    advance();
  }, [advance]);

  return {
    currentCard: cards[index] ?? null,
    loading,
    scores,
    activeTeam,
    guess,
    skip,
    passTurn,
  };
}
