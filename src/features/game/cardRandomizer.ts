// Card randomiser — delegates randomness to the DB via pick_random_cards().
// ORDER BY random() happens server-side so category distribution is always fair,
// regardless of how records are stored on disk.

import { supabase } from '@/shared/lib/supabase';
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
