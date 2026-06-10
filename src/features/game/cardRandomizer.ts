// Card randomiser — delegates randomness to the DB via pick_random_cards().
// ORDER BY random() happens server-side so category distribution is always fair,
// regardless of how records are stored on disk.

import { supabase } from '@/shared/lib/supabase';
import type { Card, CardCategory } from '@/shared/types/database';

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
  const { data, error } = await supabase.rpc('pick_random_cards', {
    p_count:         count,
    p_categories:    categories?.length ? categories : null,
    p_min_pageviews: minPageviews ?? null,
  });

  if (error) throw new Error(`pick_random_cards failed: ${error.message}`);
  if (!data?.length) throw new Error('No active cards found for the selected categories');

  return data as Card[];
}
