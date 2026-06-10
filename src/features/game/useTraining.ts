import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { PAGEVIEWS_THRESHOLD, type Card, type CardCategory } from '@/shared/types/database';

const BATCH       = 50;
const PRELOAD_AT  = 10; // fetch next batch when this many cards remain

export type Team = 'orange' | 'blue';

export interface HistoryEntry {
  name: string;
  name_en?: string | null; // English name when the card has one; summary uses it on EN
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

  // Global Easy/Hard toggle → minimum pageviews floor for the deck.
  const difficulty   = useSettingsStore((s) => s.difficulty);
  const minPageviews = PAGEVIEWS_THRESHOLD[difficulty];

  // Initial load
  useEffect(() => {
    pickRandomCards(BATCH, categories, minPageviews)
      .then((batch) => setCards(batch))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [categories, minPageviews]);

  // Preload next batch silently
  const preloadMore = useCallback(() => {
    if (isPreloadingRef.current) return;
    isPreloadingRef.current = true;
    pickRandomCards(BATCH, categories, minPageviews)
      .then((batch) => setCards((prev) => [...prev, ...batch]))
      .catch(() => undefined)
      .finally(() => { isPreloadingRef.current = false; });
  }, [categories, minPageviews]);

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
    // Capture an optional English name if the card carries one (cards.name_en).
    // It's absent today, so the summary falls back to the Russian `name` on EN.
    const nameEn = (card as { name_en?: string | null }).name_en ?? null;
    setHistory((prev) => [...prev, { name: card.name, name_en: nameEn, category: card.category, status }]);
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
