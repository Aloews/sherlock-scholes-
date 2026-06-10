// Card randomiser — delegates randomness to the DB via pick_random_cards().
// ORDER BY random() happens server-side so category distribution is always fair,
// regardless of how records are stored on disk.

import { supabase } from '@/shared/lib/supabase';
import type { Card, CardCategory } from '@/shared/types/database';

// A cold-started Supabase instance can fail or return an empty set on the very
// first RPC of a session. Retry a couple of times before surfacing the error,
// so callers keep their loading state instead of flashing "no cards".
const RETRIES        = 2;
const RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch `count` random active cards from the DB.
 * @param count        Number of cards to return.
 * @param categories   Optional allow-list of categories. null/undefined = all.
 * @param minPageviews Optional difficulty floor — player cards below this many
 *                     Wikipedia pageviews are excluded. Cards with no pageviews
 *                     score (clubs, terms, …) always pass. null/undefined = off.
 */
export async function pickRandomCards(
  count: number,
  categories?: CardCategory[] | null,
  minPageviews?: number | null,
): Promise<Card[]> {
  let lastError = new Error('pick_random_cards failed');

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    const { data, error } = await supabase.rpc('pick_random_cards', {
      p_count:         count,
      p_categories:    categories?.length ? categories : null,
      p_min_pageviews: minPageviews ?? null,
    });

    if (error) {
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
