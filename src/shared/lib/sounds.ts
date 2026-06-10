// HTML5 Audio utility — lazy-init, error-safe. The on/off flag is
// settingsStore.soundEnabled (persisted), shared with the home-screen toggle.

import { useSettingsStore } from '@/shared/store/settingsStore';

export type SoundName = 'tick' | 'correct' | 'skip' | 'gong' | 'swipe'
                      | 'whistle_start' | 'whistle_end' | 'kick' | 'applause';

const VOLUME = 0.5;

const instances: Partial<Record<SoundName, HTMLAudioElement>> = {};

function getAudio(name: SoundName): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!instances[name]) {
    try {
      const el = new Audio(`/sounds/${name}.wav`);
      el.volume   = VOLUME;
      el.preload  = 'auto';
      instances[name] = el;
    } catch {
      return null;
    }
  }
  return instances[name] ?? null;
}

// Kept for the in-game mute button — both now delegate to settingsStore, so
// the game-screen button and the home-screen toggle always stay in sync.
export function isMuted(): boolean {
  return !useSettingsStore.getState().soundEnabled;
}

export function toggleMute(): void {
  const { soundEnabled, setSoundEnabled } = useSettingsStore.getState();
  setSoundEnabled(!soundEnabled);
}

export function playSound(name: SoundName): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const audio = getAudio(name);
  if (!audio) return;
  try {
    audio.currentTime = 0;
    const promise = audio.play();
    promise?.catch(() => {
      // Autoplay blocked or file missing — fail silently
    });
  } catch {
    // Older browser or missing file — ignore
  }
}
