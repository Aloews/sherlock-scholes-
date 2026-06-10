import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Difficulty } from '@/shared/types/database';

// Device-wide game preferences that survive reloads (localStorage).
// `difficulty` is the global Easy/Hard toggle on the home screen — it gates
// how famous the footballers in the deck are (see PAGEVIEWS_THRESHOLD).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.

interface SettingsState {
  difficulty: Difficulty;
  soundEnabled: boolean;
  setDifficulty(d: Difficulty): void;
  setSoundEnabled(on: boolean): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      difficulty: 'easy',
      soundEnabled: true,
      setDifficulty: (difficulty) => set({ difficulty }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
    }),
    { name: 'sherlock_settings' },
  ),
);
