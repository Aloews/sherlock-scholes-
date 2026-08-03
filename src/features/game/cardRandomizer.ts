// Card randomiser — the whole deck contract, client side.
//
// Both calls take the SAME DeckFilter object and hit the same SQL
// predicate (supabase/migrations/deck_rpc.sql):
//   pickCards()  -> pick_random_cards(filter, count, init_data)
//   countCards() -> count_deck(filter, init_data)
//
// That is the point of the rewrite. The old countDeck() rebuilt the WHERE
// clause by hand out of PostgREST filters and quietly skipped the
// onboarding floor, the language filter and the Pro check, so the number
// under the Play button described a deck the game would never deal. Now
// the counter and the draw are one query.
//
// ORDER BY random() still happens server-side so category distribution is
// fair regardless of storage order.

import { supabase } from '@/shared/lib/supabase';
import { trackEvent } from '@/shared/lib/analytics';
import { getRawInitData } from '@/shared/lib/telegram';
import type { Card } from '@/shared/types/database';
import { normalizeFilter, type DeckFilter } from '@/shared/types/deck';

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

// initData is sent on every deck call now: the server needs it to decide
// whether a Pro-only tag ('legend', 'ballon_dor') survives the filter. It is
// empty outside Telegram, which the RPC reads as "not Pro".
const initData = () => getRawInitData() || null;

/**
 * Fetch `count` random active cards matching the filter.
 *
 * PostgREST caps a single response at its max-rows setting (1000 here)
 * regardless of `count` — callers wanting the whole deck must call
 * repeatedly and dedupe by id (see useTraining).
 */
export async function pickCards(filter: DeckFilter, count: number): Promise<Card[]> {
  let lastError = new Error('pick_random_cards failed');
  const started = Date.now();
  const payload = normalizeFilter(filter);

  // attempt 0 is immediate; each later attempt waits RETRY_BACKOFFS_MS[i-1].
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFFS_MS[attempt - 1]);

    const { data, error } = await supabase.rpc('pick_random_cards', {
      p_filter: payload,
      p_count: count,
      p_init_data: initData(),
    });

    if (error) {
      lastError = new Error(`pick_random_cards failed: ${error.message}`);
      continue;
    }
    if (!data?.length) {
      lastError = new Error('No active cards found for the selected filter');
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

// Everything the quick game needs to PLAY a card and to draw its history row
// the instant it is decided. The five heavy JSONB columns — clubs_minutes,
// legend_career, career_stats, facts, descriptions — are deliberately absent;
// fetchCardDetails() brings those in for the handful of cards actually about
// to be played. See pickCardsLight.
//
// Also absent because nothing in the quick game reads them: forbidden_words,
// pageviews_i18n, langs, tags, difficulty, continent, delete_candidate.
const LIGHT_COLUMNS = [
  'id', 'name', 'name_en', 'category', 'category_ru', 'photo_url', 'tier',
  'country', 'position_ru', 'top_club', 'top_minutes',
].join(',');

/** The five columns that make a full card row expensive. */
export const CARD_DETAIL_COLUMNS =
  'id,clubs_minutes,legend_career,career_stats,facts,descriptions';

/**
 * A batch for the quick game, without the heavy JSONB.
 *
 * Same RPC and predicate as pickCards — this deals exactly what pickCards
 * would. A batch is up to 1000 cards, and asking for whole rows cost 1.41 MB
 * to start a game; without the five JSONB columns it is 364 kB, and the
 * career lines are fetched per card as play approaches them.
 *
 * card_translations cannot be embedded here — PostgREST reads it as a column
 * of the function's result and errors. useTraining already fetches those
 * separately, which is why that is not a loss.
 */
export async function pickCardsLight(filter: DeckFilter, count: number): Promise<Card[]> {
  const { data, error } = await supabase
    .rpc('pick_random_cards', {
      p_filter: normalizeFilter(filter),
      p_count: count,
      p_init_data: initData(),
    })
    .select(LIGHT_COLUMNS);
  if (error) throw new Error(`pick_random_cards failed: ${error.message}`);
  // The narrowed row is a Card minus the heavy columns; the game treats a
  // missing career line and an absent one identically, so the cast is honest.
  return (data ?? []) as unknown as Card[];
}

/**
 * The ids of `count` random cards matching the filter — nothing else.
 *
 * Same RPC and therefore the same `cards_matching` predicate as pickCards, so
 * the deck contract is untouched: this deals exactly what pickCards would.
 * `.select('id')` narrows the response server-side, which matters because the
 * only caller — activateRound — inserts round_cards and never looks at a
 * single other column. Measured on a 100-card deal: 141 kB -> 4.9 kB.
 */
export async function pickCardIds(filter: DeckFilter, count: number): Promise<string[]> {
  const { data, error } = await supabase
    .rpc('pick_random_cards', {
      p_filter: normalizeFilter(filter),
      p_count: count,
      p_init_data: initData(),
    })
    .select('id');
  if (error) throw new Error(`pick_random_cards failed: ${error.message}`);
  const ids = (data ?? []) as { id: string }[];
  if (!ids.length) throw new Error('No active cards found for the selected filter');
  return ids.map((r) => r.id);
}

/**
 * Count the cards the filter would deal — the live counter in the picker.
 * Same predicate as pickCards, so the two can never disagree. Debounce at
 * the call site; a failed count returns null so the UI can say "—" instead
 * of claiming an empty deck.
 */
export async function countCards(filter: DeckFilter): Promise<number | null> {
  const { data, error } = await supabase.rpc('count_deck', {
    p_filter: normalizeFilter(filter),
    p_init_data: initData(),
  });
  if (error) return null;
  return typeof data === 'number' ? data : Number(data ?? 0);
}
