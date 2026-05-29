import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import type { Card, CardCategory } from '@/shared/types/database';

const BATCH       = 50;
const PRELOAD_AT  = 10; // fetch next batch when this many cards remain

export function useTraining(categories: CardCategory[] | null) {
  const [cards,   setCards]   = useState<Card[]>([]);
  const [index,   setIndex]   = useState(0);
  const [loading, setLoading] = useState(true);
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

  const next = useCallback(() => {
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= cards.length - PRELOAD_AT) preloadMore();
      return next;
    });
  }, [cards.length, preloadMore]);

  return {
    currentCard: cards[index] ?? null,
    index,
    loading,
    next,
  };
}
