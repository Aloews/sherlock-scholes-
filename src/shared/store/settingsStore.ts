import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Difficulty } from '@/shared/types/database';

// Device-wide game preferences that survive reloads (localStorage).
// `difficulty` is the global three-level switch on the home screen —
// novice/fan/expert, gating the deck by pageviews (see PAGEVIEWS_THRESHOLD).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.

interface SettingsState {
  difficulty: Difficulty;
  soundEnabled: boolean;
  setDifficulty(d: Difficulty): void;
  setSoundEnabled(on: boolean): void;
}

const DIFFICULTIES: readonly Difficulty[] = ['novice', 'fan', 'expert'];

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      difficulty: 'fan',
      soundEnabled: true,
      setDifficulty: (difficulty) => set({ difficulty }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
    }),
    {
      name: 'sherlock_settings',
      version: 1,
      // v0 stored 'easy' / 'hard' — coerce anything unknown to the default.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<SettingsState>;
        if (!DIFFICULTIES.includes(s.difficulty as Difficulty)) {
          s.difficulty = 'fan';
        }
        return s as SettingsState;
      },
    },
  ),
);
