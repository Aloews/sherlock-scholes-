import { create } from 'zustand';

// Pro status — a MIRROR of the server's answer (get_user_status RPC), never a
// client-owned source of truth. Defaults to false; only a validated server
// response flips isPro. Editing this in DevTools changes nothing real: the
// deck/payment paths re-check server-side.

interface ProState {
  telegramId: number | null;
  isPro: boolean;
  proSince: string | null;
  loading: boolean;
  loaded: boolean; // status fetch attempted (success or skip)

  setStatus(s: { telegramId: number; isPro: boolean; proSince: string | null }): void;
  setLoading(v: boolean): void;
  markLoaded(): void;
}

export const useProStore = create<ProState>((set) => ({
  telegramId: null,
  isPro: false,
  proSince: null,
  loading: false,
  loaded: false,

  setStatus: ({ telegramId, isPro, proSince }) =>
    set({ telegramId, isPro, proSince, loaded: true, loading: false }),
  setLoading: (loading) => set({ loading }),
  markLoaded: () => set({ loaded: true, loading: false }),
}));
