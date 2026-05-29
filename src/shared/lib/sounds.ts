// HTML5 Audio utility — lazy-init, mute-flag in localStorage, error-safe.

export type SoundName = 'tick' | 'correct' | 'skip' | 'gong';

const MUTE_KEY = 'sherlock_muted';
const VOLUME   = 0.5;

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

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function toggleMute(): void {
  try {
    localStorage.setItem(MUTE_KEY, String(!isMuted()));
  } catch {
    // localStorage unavailable — ignore
  }
}

export function playSound(name: SoundName): void {
  if (isMuted()) return;
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
