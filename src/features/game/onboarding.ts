// Onboarding — progressive difficulty for the DEFAULT quick game.
//
// New players' first ~10 games show only the most recognizable cards, then the
// pool smoothly widens to the full deck by ~game 30. The signal is a pageviews
// floor passed to pick_random_cards as p_difficulty; tier legendary/epic and
// the wc2026 tag always pass the floor (handled server-side).
//
// Counter source: logged-in users -> server (users.games_played via bump_games);
// anonymous -> Telegram CloudStorage (localStorage is banned in the Mini App).
// Both are mirrored into proStore.gamesPlayed.

import { getRawInitData, cloudGet, cloudSet } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import { bumpGames } from '@/features/pro/proApi';

const CLOUD_KEY = 'ss_games_played';

// Pageviews floor by games played; null = no cap (full deck).
//   games <10   -> 60000 (strict plateau: ~255 household-name players +
//                         tier legendary/epic — no obscure cards at all)
//   games 10-29 -> floor decays 60000 -> ~0 (pool grows smoothly)
//   games >=30  -> null  (full deck)
// Server side (pick_random_cards) only tier legendary/epic bypasses the
// floor — the old wc2026 bypass let obscure tournament newcomers flood the
// easy pool and made first games feel hard.
export function difficultyFloor(games: number): number | null {
  if (games >= 30) return null;
  if (games < 10) return 60000;
  return Math.round((60000 * (30 - games)) / 20);
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
