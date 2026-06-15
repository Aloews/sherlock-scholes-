import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProFrame } from '@/shared/lib/pro';

// Device-wide game preferences that survive reloads (localStorage).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.
// `proFrame` is a Pro cosmetic (avatar ring); it only renders when the user
// is actually Pro (server-checked) — storing it for a free user is harmless.

interface SettingsState {
  soundEnabled: boolean;
  setSoundEnabled(on: boolean): void;
  proFrame: ProFrame;
  setProFrame(frame: ProFrame): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      proFrame: 'default',
      setProFrame: (proFrame) => set({ proFrame }),
    }),
    {
      name: 'sherlock_settings',
      version: 3,
      // v0/v1 stored a `difficulty` switch — dropped. v2 had only soundEnabled;
      // v3 adds proFrame (default).
      migrate: (persisted) => {
        const s = (persisted ?? {}) as { soundEnabled?: boolean; proFrame?: ProFrame };
        return {
          soundEnabled: s.soundEnabled !== false,
          proFrame: s.proFrame ?? 'default',
        } as SettingsState;
      },
    },
  ),
);
