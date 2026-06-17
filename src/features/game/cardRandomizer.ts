// Card randomiser — delegates randomness to the DB via pick_random_cards().
// ORDER BY random() happens server-side so category distribution is always fair,
// regardless of how records are stored on disk.

import { supabase } from '@/shared/lib/supabase';
import { ALL_CATEGORIES } from '@/shared/types/database';
import { trackEvent } from '@/shared/lib/analytics';
import { getRawInitData } from '@/shared/lib/telegram';
import { isProTag } from '@/shared/lib/pro';
import type { Card, CardCategory, ContinentFilter } from '@/shared/types/database';

// Free-tier Supabase pauses when idle and can take 5-30s to wake; the first
// RPC of a cold session may error, time out, or return an empty set. Retry
// with growing backoff (≈10s total across 5 attempts) so callers keep their
// loading indicator instead of flashing "no cards". "No cards" is surfaced
// only after every attempt fails. The home screen also pings the DB on mount
// (wakeSupabase) so it is usually warm by the time the player taps Play.
const RETRY_BACKOFFS_MS = [800, 1500, 3000, 5000]; // 5 attempts (1 + 4 retries)
// A card load slower than this is reported to analytics as a slow load.
const SLOW_LOAD_MS = 2500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wake a sleeping free-tier DB with a tiny HEAD count — fire-and-forget,
 * never throws. Called when the home screen mounts so the deck RPC is warm by
 * game start. */
export async function wakeSupabase(): Promise<void> {
  try {
    await supabase.from('cards').select('id', { count: 'exact', head: true }).limit(1);
  } catch {
    /* warm-up is best-effort */
  }
}

// The p_continents parameter exists only after continents_filter.sql ran.
// Until then PostgREST rejects the 4-arg call (PGRST202: no matching function),
// so after the first such rejection we stop sending the parameter for the rest
// of the session — the game keeps working, just without the continent filter.
let rpcSupportsContinents = true;
// p_tags exists only after pick_random_cards_tags.sql ran — same graceful
// degrade: drop it after the first PGRST202 and play without the tag filter.
let rpcSupportsTags = true;
// p_init_data exists only after pro_deck.sql ran. We send it only when a
// pro-only tag is requested (so the server can enforce is_pro). Before that
// migration the UI lock is the only guard — drop the param and keep playing.
let rpcSupportsInitData = true;
// p_difficulty exists only after pro_onboarding.sql ran. Sent only for the
// default quick game (onboarding floor). Drop it on the first PGRST202 and
// play without the difficulty cap.
let rpcSupportsDifficulty = true;

const isMissingContinentsParam = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || error.message.includes('p_continents');
const isMissingTagsParam = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || error.message.includes('p_tags');
const isMissingInitDataParam = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || error.message.includes('p_init_data');
const isMissingDifficultyParam = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || error.message.includes('p_difficulty');

/**
 * Fetch `count` random active cards from the DB.
 * @param count        Number of cards to return. PostgREST caps a single
 *                     response at its max-rows setting (1000 here) regardless
 *                     of `count` — callers wanting the whole deck must call
 *                     repeatedly and dedupe by id (see useTraining).
 * @param categories   Optional allow-list of categories. null/undefined = all.
 * @param minPageviews Optional difficulty floor — player cards below this many
 *                     Wikipedia pageviews are excluded. Cards with no pageviews
 *                     score (clubs, terms, …) always pass. null/undefined = off.
 * @param continents   Optional player-continent filter ('other' = continent
 *                     IS NULL). Only player cards are filtered; the rest pass.
 *                     Silently ignored while the DB lacks continents_filter.sql.
 * @param tags         Optional special-category filter (cards.tags overlap),
 *                     e.g. ['goalkeeper'] or ['star']. Players only (non-player
 *                     tags are NULL). Ignored while the DB lacks p_tags.
 * @param difficulty   Onboarding pageviews floor for the DEFAULT quick game
 *                     (new players get only recognizable cards, easing up over
 *                     ~30 games). tier legendary/epic + wc2026 always pass.
 *                     null = no cap. Ignored while the DB lacks p_difficulty.
 */
export async function pickRandomCards(
  count: number,
  categories?: CardCategory[] | null,
  minPageviews?: number | null,
  continents?: ContinentFilter[] | null,
  tags?: string[] | null,
  difficulty?: number | null,
): Promise<Card[]> {
  let lastError = new Error('pick_random_cards failed');
  const started = Date.now();

  // attempt 0 is immediate; each later attempt waits RETRY_BACKOFFS_MS[i-1].
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFFS_MS[attempt - 1]);

    const withContinents = rpcSupportsContinents && !!continents?.length;
    const withTags = rpcSupportsTags && !!tags?.length;
    // Server-side Pro enforcement only matters when a pro-only tag is asked
    // for; sending the signed initData lets the RPC verify is_pro.
    const needsInitData = !!tags?.some(isProTag);
    const withInitData = rpcSupportsInitData && needsInitData;
    const withDifficulty = rpcSupportsDifficulty && difficulty != null && difficulty > 0;
    const { data, error } = await supabase.rpc('pick_random_cards', {
      p_count:         count,
      p_categories:    categories?.length ? categories : null,
      p_min_pageviews: minPageviews ?? null,
      ...(withContinents ? { p_continents: continents } : {}),
      ...(withTags ? { p_tags: tags } : {}),
      ...(withInitData ? { p_init_data: getRawInitData() } : {}),
      ...(withDifficulty ? { p_difficulty: difficulty } : {}),
    });

    if (error) {
      if (withDifficulty && isMissingDifficultyParam(error)) {
        // Pre-migration DB (no p_difficulty) — drop it and redo this attempt.
        rpcSupportsDifficulty = false;
        attempt--;
        continue;
      }
      if (withInitData && isMissingInitDataParam(error)) {
        // Pre-migration DB (no p_init_data) — drop it and redo this attempt.
        rpcSupportsInitData = false;
        attempt--;
        continue;
      }
      if (withTags && isMissingTagsParam(error)) {
        // Pre-migration DB (no p_tags) — drop it and redo this attempt.
        rpcSupportsTags = false;
        attempt--;
        continue;
      }
      if (withContinents && isMissingContinentsParam(error)) {
        // Pre-migration DB — drop the parameter and redo this attempt.
        rpcSupportsContinents = false;
        attempt--;
        continue;
      }
      lastError = new Error(`pick_random_cards failed: ${error.message}`);
      continue;
    }
    if (!data?.length) {
      lastError = new Error('No active cards found for the selected categories');
      continue;
    }
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_LOAD_MS) {
      // Anonymous timing only — how slow and how many retries it took.
      trackEvent('cards_slow_load', { ms: elapsed, attempts: attempt + 1 });
    }
    return data as Card[];
  }

  throw lastError;
}

/**
 * Count active cards matching a deck filter — the live "Выбрано: N" counter
 * on the quick-game picker. Mirrors pick_random_cards' WHERE: the continent
 * filter touches only player cards, 'other' means continent IS NULL, and
 * min_pageviews keeps cards with no score (NULL) like the RPC does.
 * Players and non-players are counted with separate head requests and summed
 * (the cross-category OR is awkward for PostgREST). Debounce at the call site.
 */
export async function countDeck(
  categories: CardCategory[] | null,
  continents: ContinentFilter[] | null,
  minPageviews: number | null,
  tags: string[] | null = null,
): Promise<number> {
  const cats = categories?.length ? categories : ALL_CATEGORIES;
  const playerIncluded = cats.includes('player');
  const nonPlayer = cats.filter((c) => c !== 'player');
  const hasTags = !!tags?.length;
  let total = 0;

  // A tag filter excludes every non-player card (their tags are NULL), so skip
  // the non-player count entirely when tags are selected.
  if (nonPlayer.length && !hasTags) {
    const { count } = await supabase
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .in('category', nonPlayer);
    total += count ?? 0;
  }

  if (playerIncluded) {
    let q = supabase
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .eq('category', 'player');
    if (hasTags) {
      q = q.overlaps('tags', tags as string[]);  // mirrors RPC tags && p_tags
    }
    if (minPageviews != null) {
      // RPC keeps NULL-pageviews cards too.
      q = q.or(`pageviews.gt.${minPageviews},pageviews.is.null`);
    }
    if (continents?.length) {
      const real = continents.filter((c) => c !== 'other');
      const hasOther = continents.includes('other');
      if (hasOther && real.length) {
        q = q.or(`continent.in.(${real.join(',')}),continent.is.null`);
      } else if (hasOther) {
        q = q.is('continent', null);
      } else {
        q = q.in('continent', real);
      }
    }
    const { count } = await q;
    total += count ?? 0;
  }

  return total;
}
