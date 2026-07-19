import { useState, useEffect, useCallback, useRef } from 'react';
import { pickRandomCards } from './cardRandomizer';
import { supabase } from '@/shared/lib/supabase';
import { isCardTranslationLang } from '@/shared/lib/cardName';
import { trackEvent } from '@/shared/lib/analytics';
import i18n from '@/shared/i18n';
import type { Card, CardCategory, CardTranslation, ClubMinutes, LegendCareer, CareerStat, CardFacts, ContinentFilter } from '@/shared/types/database';

// No card cap: the game runs until the deck of the selected categories is
// exhausted. PostgREST returns at most 1000 rows per request, so the deck is
// pulled in batches of that size and deduped by id — pick_random_cards draws
// randomly, so later batches overlap with what we've already seen.
const BATCH       = 1000; // PostgREST max-rows cap per request
const PRELOAD_AT  = 25;   // fetch next batch when this many cards remain
// A batch shorter than BATCH means the whole (filtered) deck fit into it.
// Otherwise the deck is exhausted when batches stop bringing new cards.
const MAX_ZERO_NEW_BATCHES = 2;

// Cards come from the pick_random_cards RPC (no embedded relations), so for
// es/pt/fr/zh/ja/ko/ar the translations arrive as a separate light query by
// the ids of the drawn cards — chunked so the IN() URL stays short.
const TRANSLATION_CHUNK = 150;

export type Team = 'orange' | 'blue';

export interface HistoryEntry {
  id: string; // card id — lets the summary "report an error" button reference it
  name: string;
  name_en?: string | null; // English name when the card has one; summary uses it on EN
  photo_url?: string | null; // Commons photo; summary shows it as an avatar
  category: CardCategory;
  category_ru?: string | null; // summary shows it as a label on non-player cards
  country?: string | null; // ISO code -> flag badge on the history avatar
  position_ru?: string | null; // -> the "флаг страна · позиция" line
  top_club?: string | null; // club + minutes of the player's best season —
  top_minutes?: number | null; // the summary line under the name; null = hide
  clubs_minutes?: ClubMinutes[] | null; // active players: clubs with minutes
  legend_career?: LegendCareer | null;  // legends: clubs with years (no minutes)
  career_stats?: CareerStat[] | null;   // veterans: clubs with apps+goals (Wikipedia)
  facts?: CardFacts | null;             // structural facts -> bright-fact line
  descriptions?: Record<string, string> | null; // non-player blurb under the name
  tier?: string | null;                 // rarity tier -> coloured avatar ring
  card_translations?: CardTranslation[] | null; // es/pt/fr/... names (cardDisplayName)
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
  minPageviews: number | null = null,
  tags: string[] | null = null,
  difficulty: number | null = null,
  boostCountries: string[] | null = null,
  lang: string | null = null,
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

  // Merge the chosen language's card names into the loaded cards. Failures
  // (pre-migration DB, network) are silent — the game plays on name_en/name.
  const fetchTranslations = useCallback(async (ids: string[]) => {
    const lang = i18n.language.slice(0, 2);
    if (!isCardTranslationLang(lang) || ids.length === 0) return;
    const byId: Record<string, CardTranslation[]> = {};
    for (let i = 0; i < ids.length; i += TRANSLATION_CHUNK) {
      const { data } = await supabase
        .from('card_translations')
        .select('card_id,lang,name')
        .eq('lang', lang)
        .in('card_id', ids.slice(i, i + TRANSLATION_CHUNK));
      for (const t of data ?? []) {
        (byId[t.card_id] ??= []).push(t as CardTranslation);
      }
    }
    if (Object.keys(byId).length === 0) return;
    setCards((prev) => prev.map(
      (c) => (byId[c.id] ? { ...c, card_translations: byId[c.id] } : c)));
  }, []);

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
    if (fresh.length) {
      setCards((prev) => [...prev, ...fresh]);
      void fetchTranslations(fresh.map((card) => card.id));
    }
  }, [fetchTranslations]);

  // Initial load. minPageviews is the "Только звёзды" floor (null = whole deck).
  useEffect(() => {
    seenIdsRef.current = new Set();
    zeroNewRef.current = 0;
    exhaustedRef.current = false;
    pickRandomCards(BATCH, categories, minPageviews, continents, tags, difficulty, boostCountries, lang)
      .then(absorbBatch)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [categories, continents, minPageviews, tags, difficulty, boostCountries, lang, absorbBatch]);

  // Preload next batch silently
  const preloadMore = useCallback(() => {
    if (isPreloadingRef.current || exhaustedRef.current) return;
    isPreloadingRef.current = true;
    pickRandomCards(BATCH, categories, minPageviews, continents, tags, difficulty, boostCountries, lang)
      .then(absorbBatch)
      .catch(() => undefined)
      .finally(() => { isPreloadingRef.current = false; });
  }, [categories, continents, minPageviews, tags, difficulty, boostCountries, lang, absorbBatch]);

  // Top up the deck as the player nears the end. Decoupled from the tap
  // handler (was inside the setIndex updater) so a batch arriving mid-transition
  // can never disturb the index (#3); if index briefly outruns the loaded
  // cards, currentCard falls back to null and this effect refills the deck.
  useEffect(() => {
    if (index >= cards.length - PRELOAD_AT) preloadMore();
  }, [index, cards.length, preloadMore]);

  // Advance to the next card. Functional update only — never
  // setIndex(index + 1) with a captured index, so rapid taps can't reuse a
  // stale value (#1).
  const advance = useCallback(() => {
    setIndex((prev) => prev + 1);
  }, []);

  // Append the current card to the in-memory history
  const recordCurrent = useCallback((status: HistoryEntry['status']) => {
    const card = cards[index];
    if (!card) return;
    // Anonymous: which cards teams solve vs get stuck on, by category + rarity
    // tier. No card id / name / user data — only the two aggregate dimensions.
    trackEvent(status === 'guessed' ? 'card_guessed' : 'card_skipped', {
      category: card.category, tier: card.tier ?? 'none',
    });
    setHistory((prev) => [...prev, { id: card.id, name: card.name, name_en: card.name_en, photo_url: card.photo_url, category: card.category, category_ru: card.category_ru, country: card.country, position_ru: card.position_ru, top_club: card.top_club, top_minutes: card.top_minutes, clubs_minutes: card.clubs_minutes, legend_career: card.legend_career, career_stats: card.career_stats, facts: card.facts, descriptions: card.descriptions, tier: card.tier, card_translations: card.card_translations, status }]);
  }, [cards, index]);

  // One card transition at a time. While the 0.18s card animation runs we
  // ignore further guess/skip/pass taps (#2) — this kills the race where fast
  // taps stack: double-recording a card while the index jumps, OR handing
  // AnimatePresence (mode="wait") a new key mid-exit so the card visually
  // "sticks" while the history keeps growing underneath. The lock releases
  // just after the animation, so each registered tap flips exactly one card
  // and the history always matches the score.
  const processingRef = useRef(false);
  const runStep = useCallback((apply: () => void) => {
    if (processingRef.current) return;
    processingRef.current = true;
    apply();
    setTimeout(() => { processingRef.current = false; }, 250);
  }, []);

  // +1 to active team, show next card
  const guess = useCallback(() => runStep(() => {
    recordCurrent('guessed');
    setScores((prev) => ({ ...prev, [activeTeam]: prev[activeTeam] + 1 }));
    advance();
  }), [runStep, recordCurrent, advance, activeTeam]);

  // Next card, no point
  const skip = useCallback(() => runStep(() => {
    recordCurrent('skipped');
    advance();
  }), [runStep, recordCurrent, advance]);

  // Switch active team and move to the next card (current card goes unsolved)
  const passTurn = useCallback(() => runStep(() => {
    recordCurrent('skipped');
    setActiveTeam((prev) => (prev === 'orange' ? 'blue' : 'orange'));
    advance();
  }), [runStep, recordCurrent, advance]);

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
