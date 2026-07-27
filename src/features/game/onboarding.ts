// Onboarding — progressive difficulty for the DEFAULT quick game.
//
// New players' first ~10 games show only the most recognizable cards, then
// the pool smoothly widens to the full deck by ~game 30.
//
// The signal is a floor on the ONE fame axis (cards.fame, 0..100 — see
// supabase/migrations/deck_fame.sql), passed as DeckFilter.fame_min. That
// is the very same field the picker's "насколько известные" step writes,
// so onboarding is no longer a separate difficulty dimension: the two
// collapse with Math.max() and the player always gets the stricter of the
// floor they chose and the floor their experience implies.
//
// This also retires LANG_BOOST_COUNTRIES. That list existed because the old
// fame signal was ru-wiki pageviews, so a Mexican or Korean star ranked as
// a nobody and needed a per-language relief valve. cards.fame takes the
// MAX across nine language Wikipedias, which gives local heroes a real
// score in the first place — the hack has nothing left to fix.
//
// Counter source: logged-in users -> server (users.games_played via bump_games);
// anonymous -> Telegram CloudStorage (localStorage is banned in the Mini App).
// Both are mirrored into proStore.gamesPlayed.

import { getRawInitData, cloudGet, cloudSet } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import { bumpGames } from '@/features/pro/proApi';

const CLOUD_KEY = 'ss_games_played';

// Fame floor by games played; 0 = no floor (full deck).
//   games <10   -> 85 (the top ~15% of every category: household names only)
//   games 10-29 -> decays 85 -> 0 (the pool grows smoothly)
//   games >=30  -> 0  (full deck)
export function fameFloor(games: number): number {
  if (games >= 30) return 0;
  if (games < 10) return 85;
  return Math.round((85 * (30 - games)) / 20);
}

// Read the anonymous counter from CloudStorage into proStore (called when there
// is no validated Telegram identity). Best-effort.
export async function loadAnonGames(): Promise<void> {
  const raw = await cloudGet(CLOUD_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  useProStore.getState().setGamesPlayed(Number.isFinite(n) ? n : 0);
}

// Record one quick-game start: increment the counter (server when logged in,
// else CloudStorage) and update proStore. Returns nothing — fire and forget;
// the difficulty for THIS game was computed from the pre-increment count.
export async function recordQuickGameStart(): Promise<void> {
  const { telegramId, gamesPlayed, setGamesPlayed } = useProStore.getState();
  const next = gamesPlayed + 1;
  setGamesPlayed(next); // optimistic

  if (telegramId != null) {
    const server = await bumpGames(getRawInitData());
    if (server != null) setGamesPlayed(server); // server is authoritative
  } else {
    await cloudSet(CLOUD_KEY, String(next));
  }
}
