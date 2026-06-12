import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import type { Card, CardCategory, ContinentFilter } from '@/shared/types/database';

// No card cap: the game runs until the deck of the selected categories is
// exhausted. PostgREST returns at most 1000 rows per request, so the deck is
// pulled in batches of that size and deduped by id — pick_random_cards draws
// randomly, so later batches overlap with what we've already seen.
const BATCH       = 1000; // PostgREST max-rows cap per request
const PRELOAD_AT  = 25;   // fetch next batch when this many cards remain
// A batch shorter than BATCH means the whole (filtered) deck fit into it.
// Otherwise the deck is exhausted when batches stop bringing new cards.
const MAX_ZERO_NEW_BATCHES = 2;

export type Team = 'orange' | 'blue';

export interface HistoryEntry {
  name: string;
  name_en?: string | null; // English name when the card has one; summary uses it on EN
  photo_url?: string | null; // Commons photo; summary shows it as an avatar
  category: CardCategory;
  category_ru?: string | null; // summary shows it as a label on non-player cards
  top_club?: string | null; // club + minutes of the player's best season —
  top_minutes?: number | null; // the summary line under the name; null = hide
  status: 'guessed' | 'skipped';
}

/**
 * Quick Game — one phone, two teams, running score, no timer, no card cap:
 * the game runs until the deck of the selected categories/continents runs out.
 * Cards are loaded in batches and deduped by id (no DB persistence, no repeats
 * within a session).
 */
export function useTraining(
  categories: CardCategory[] | null,
  continents: ContinentFilter[] | null = null,
) {
  const [cards,   setCards]   = useState<Card[]>([]);
  const [index,   setIndex]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [scores,  setScores]  = useState<Record<Team, number>>({ orange: 0, blue: 0 });
  const [activeTeam, setActiveTeam] = useState<Team>('orange');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const isPreloadingRef = useRef(false);
  const seenIdsRef      = useRef<Set<string>>(new Set());
  const zeroNewRef      = useRef(0);     // consecutive batches with no new cards
  const exhaustedRef    = useRef(false); // deck fully drawn — stop fetching

  // Append a batch, keeping only cards we haven't seen this session, and
  // detect deck exhaustion (see BATCH/MAX_ZERO_NEW_BATCHES above).
  const absorbBatch = useCallback((batch: Card[]) => {
    const fresh = batch.filter((card) => !seenIdsRef.current.has(card.id));
    fresh.forEach((card) => seenIdsRef.current.add(card.id));
    if (batch.length < BATCH) {
      exhaustedRef.current = true; // the whole remaining deck fit in one reply
    } else if (fresh.length === 0) {
      zeroNewRef.current += 1;
      if (zeroNewRef.current >= MAX_ZERO_NEW_BATCHES) exhaustedRef.current = true;
    } else {
      zeroNewRef.current = 0;
    }
    if (fresh.length) setCards((prev) => [...prev, ...fresh]);
  }, []);

  // Initial load — null min_pageviews: the whole deck, no difficulty filter.
  useEffect(() => {
    seenIdsRef.current = new Set();
    zeroNewRef.current = 0;
    exhaustedRef.current = false;
    pickRandomCards(BATCH, categories, null, continents)
      .then(absorbBatch)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [categories, continents, absorbBatch]);

  // Preload next batch silently
  const preloadMore = useCallback(() => {
    if (isPreloadingRef.current || exhaustedRef.current) return;
    isPreloadingRef.current = true;
    pickRandomCards(BATCH, categories, null, continents)
      .then(absorbBatch)
      .catch(() => undefined)
      .finally(() => { isPreloadingRef.current = false; });
  }, [categories, continents, absorbBatch]);

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
    setHistory((prev) => [...prev, { name: card.name, name_en: card.name_en, photo_url: card.photo_url, category: card.category, category_ru: card.category_ru, top_club: card.top_club, top_minutes: card.top_minutes, status }]);
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
