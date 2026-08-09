import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProFrame } from '@/shared/lib/pro';
import { DEFAULT_DESIGN, isDesignId, type DesignId } from '@/shared/design/designs';

// Device-wide game preferences that survive reloads (localStorage).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.
// `proFrame` is a Pro cosmetic (avatar ring); it only renders when the user
// is actually Pro (server-checked) — storing it for a free user is harmless.
// `design` picks the visual language (see shared/design/designs.ts); it lives
// here — not in a store of its own — so the inline pre-paint script in
// index.html can read it from this one localStorage key and set
// <html data-design> before React mounts (no flash of the other design).

interface SettingsState {
  soundEnabled: boolean;
  /** Auto-join the voice channel on entering a room. Off means "only on tap". */
  voiceAutoConnect: boolean;
  setSoundEnabled(on: boolean): void;
  setVoiceAutoConnect(on: boolean): void;
  proFrame: ProFrame;
  setProFrame(frame: ProFrame): void;
  design: DesignId;
  setDesign(design: DesignId): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      voiceAutoConnect: true,
      setVoiceAutoConnect: (voiceAutoConnect) => set({ voiceAutoConnect }),
      proFrame: 'default',
      setProFrame: (proFrame) => set({ proFrame }),
      design: DEFAULT_DESIGN,
      setDesign: (design) => set({ design }),
    }),
    {
      name: 'sherlock_settings',
      version: 6,
      // v0/v1 stored a `difficulty` switch — dropped. v2 had only soundEnabled;
      // v3 adds proFrame; v4 added summarySort + clubSort (end-of-game ordering)
      // — dropped in v5 (the summary sort control was removed). v6 adds
      // `design`. Two different v5 shapes shipped on separate branches, so v6
      // normalises both: anything that isn't a known design id becomes the
      // default.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as {
          soundEnabled?: boolean; proFrame?: ProFrame; design?: unknown;
        };
        return {
          soundEnabled: s.soundEnabled !== false,
          proFrame: s.proFrame ?? 'default',
          design: isDesignId(s.design) ? s.design : DEFAULT_DESIGN,
        } as SettingsState;
      },
    },
  ),
);
