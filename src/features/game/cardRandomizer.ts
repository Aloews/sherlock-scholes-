// Card randomiser — delegates randomness to the DB via pick_random_cards().
// ORDER BY random() happens server-side so category distribution is always fair,
// regardless of how records are stored on disk.

import { supabase } from '@/shared/lib/supabase';
import { ALL_CATEGORIES } from '@/shared/types/database';
import type { Card, CardCategory, ContinentFilter } from '@/shared/types/database';

// A cold-started Supabase instance can fail or return an empty set on the very
// first RPC of a session. Retry a couple of times before surfacing the error,
// so callers keep their loading state instead of flashing "no cards".
const RETRIES        = 2;
const RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The p_continents parameter exists only after continents_filter.sql ran.
// Until then PostgREST rejects the 4-arg call (PGRST202: no matching function),
// so after the first such rejection we stop sending the parameter for the rest
// of the session — the game keeps working, just without the continent filter.
let rpcSupportsContinents = true;

const isMissingContinentsParam = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || error.message.includes('p_continents');

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
 */
export async function pickRandomCards(
  count: number,
  categories?: CardCategory[] | null,
  minPageviews?: number | null,
  continents?: ContinentFilter[] | null,
): Promise<Card[]> {
  let lastError = new Error('pick_random_cards failed');

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    const withContinents = rpcSupportsContinents && !!continents?.length;
    const { data, error } = await supabase.rpc('pick_random_cards', {
      p_count:         count,
      p_categories:    categories?.length ? categories : null,
      p_min_pageviews: minPageviews ?? null,
      ...(withContinents ? { p_continents: continents } : {}),
    });

    if (error) {
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
): Promise<number> {
  const cats = categories?.length ? categories : ALL_CATEGORIES;
  const playerIncluded = cats.includes('player');
  const nonPlayer = cats.filter((c) => c !== 'player');
  let total = 0;

  if (nonPlayer.length) {
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
