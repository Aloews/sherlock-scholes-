import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Device-wide game preferences that survive reloads (localStorage).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.

interface SettingsState {
  soundEnabled: boolean;
  setSoundEnabled(on: boolean): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
    }),
    {
      name: 'sherlock_settings',
      version: 2,
      // v0/v1 stored a `difficulty` switch — dropped; keep only soundEnabled.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as { soundEnabled?: boolean };
        return { soundEnabled: s.soundEnabled !== false } as SettingsState;
      },
    },
  ),
);
