import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Difficulty } from '@/shared/types/database';

// Device-wide game preferences that survive reloads (localStorage).
// `difficulty` is the global Easy/Hard toggle on the home screen — it gates
// how famous the footballers in the deck are (see PAGEVIEWS_THRESHOLD).

interface SettingsState {
  difficulty: Difficulty;
  setDifficulty(d: Difficulty): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      difficulty: 'easy',
      setDifficulty: (difficulty) => set({ difficulty }),
    }),
    { name: 'sherlock_settings' },
  ),
);
