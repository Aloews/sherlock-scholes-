import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProFrame } from '@/shared/lib/pro';

// Device-wide game preferences that survive reloads (localStorage).
// `soundEnabled` is the global sound switch — playSound() (and the in-game
// mute button) read it, so muting on the home screen silences everything.
// `proFrame` is a Pro cosmetic (avatar ring); it only renders when the user
// is actually Pro (server-checked) — storing it for a free user is harmless.

// Summary (end-of-game) card-list ordering. 'order' keeps play order.
export type SummarySort = 'order' | 'category' | 'name' | 'rarity';
// Club-line ordering inside a card: by career recency (end year) or by weight
// (appearances — biggest clubs first). 'apps' only reorders career_stats rows
// that carry an apps count; other sources keep their year order.
export type ClubSort = 'years' | 'apps';

interface SettingsState {
  soundEnabled: boolean;
  setSoundEnabled(on: boolean): void;
  proFrame: ProFrame;
  setProFrame(frame: ProFrame): void;
  summarySort: SummarySort;
  setSummarySort(sort: SummarySort): void;
  clubSort: ClubSort;
  setClubSort(sort: ClubSort): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      proFrame: 'default',
      setProFrame: (proFrame) => set({ proFrame }),
      summarySort: 'order',
      setSummarySort: (summarySort) => set({ summarySort }),
      clubSort: 'years',
      setClubSort: (clubSort) => set({ clubSort }),
    }),
    {
      name: 'sherlock_settings',
      version: 4,
      // v0/v1 stored a `difficulty` switch — dropped. v2 had only soundEnabled;
      // v3 adds proFrame; v4 adds summarySort + clubSort (end-of-game ordering).
      migrate: (persisted) => {
        const s = (persisted ?? {}) as {
          soundEnabled?: boolean; proFrame?: ProFrame;
          summarySort?: SummarySort; clubSort?: ClubSort;
        };
        return {
          soundEnabled: s.soundEnabled !== false,
          proFrame: s.proFrame ?? 'default',
          summarySort: s.summarySort ?? 'order',
          clubSort: s.clubSort ?? 'years',
        } as SettingsState;
      },
    },
  ),
);
