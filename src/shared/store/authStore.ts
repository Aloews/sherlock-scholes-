import { create } from 'zustand';
import type { Player } from '@/shared/types/database';

interface AuthState {
  player: Player | null;
  initialized: boolean;

  setPlayer(player: Player): void;
  clearPlayer(): void;
  setInitialized(v: boolean): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  player: null,
  initialized: false,

  setPlayer: (player) => set({ player }),
  clearPlayer: () => set({ player: null }),
  setInitialized: (initialized) => set({ initialized }),
}));
