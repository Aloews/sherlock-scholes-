import { create } from 'zustand';

// Pro status — a MIRROR of the server's answer (get_user_status RPC), never a
// client-owned source of truth. Defaults to false; only a validated server
// response flips isPro. Editing this in DevTools changes nothing real: the
// deck/payment paths re-check server-side.
//
// gamesPlayed drives the onboarding difficulty curve. For logged-in users it
// comes from the server (users.games_played); for anonymous players it is
// mirrored from Telegram CloudStorage. It only affects how easy the DEFAULT
// quick game feels — never gating or payment.

interface ProState {
  telegramId: number | null;
  isPro: boolean;
  proSince: string | null;
  gamesPlayed: number;
  loading: boolean;
  loaded: boolean; // status fetch attempted (success or skip)
  /**
   * Ответ пришёл из ПАМЯТКИ, а не с сервера. Ворота уже открыты, проверка ещё
   * идёт. Нужен затем, чтобы `useProStatus` не принял памятку за готовый
   * ответ и всё-таки сходил на сервер — см. proCache.ts.
   */
  seeded: boolean;

  setStatus(s: { telegramId: number; isPro: boolean; proSince: string | null; gamesPlayed: number }): void;
  /** Открыть ворота по памятке. `loaded`, но не окончательно: seeded=true. */
  seedStatus(s: { isPro: boolean; gamesPlayed: number }): void;
  setGamesPlayed(n: number): void;
  setLoading(v: boolean): void;
  markLoaded(): void;
}

export const useProStore = create<ProState>((set) => ({
  telegramId: null,
  isPro: false,
  proSince: null,
  gamesPlayed: 0,
  loading: false,
  loaded: false,
  seeded: false,

  setStatus: ({ telegramId, isPro, proSince, gamesPlayed }) =>
    set({ telegramId, isPro, proSince, gamesPlayed, loaded: true, loading: false, seeded: false }),

  seedStatus: ({ isPro, gamesPlayed }) =>
    set({ isPro, gamesPlayed, loaded: true, loading: false, seeded: true }),
  setGamesPlayed: (gamesPlayed) => set({ gamesPlayed }),
  setLoading: (loading) => set({ loading }),
  markLoaded: () => set({ loaded: true, loading: false, seeded: false }),
}));
