// The degradation ladder (docs/VIDEOCHAT_HANDOFF.md §3).
//
// Players are on different continents: 150–300 ms RTT and real packet loss are
// the normal case, not the edge case. So the level is not a button the player
// presses — it is measured, and it moves on its own.
//
// Pure on purpose: this is the part worth testing, and it is the part that
// would otherwise only be observable by flying to Buenos Aires.

export type VoiceLevel = 'full' | 'voice' | 'voice_low' | 'text';

// Worst-to-best, so a level's index is its rank.
export const VOICE_LEVELS: VoiceLevel[] = ['text', 'voice_low', 'voice', 'full'];

export interface LinkStats {
  /** Round-trip time in milliseconds. */
  rttMs: number;
  /** Fraction lost, 0–1. */
  loss: number;
}

// Thresholds from the handoff. Starting values, to be calibrated on real
// sessions — which is why they are named here rather than inlined.
const FULL_RTT = 150;
const FULL_LOSS = 0.02;
const VOICE_RTT = 400;
const VOICE_LOSS = 0.08;
const DEAD_LOSS = 0.20;

/** The level the current measurement alone would justify, ignoring history. */
export function levelFor(stats: LinkStats): VoiceLevel {
  if (stats.loss >= DEAD_LOSS) return 'text';
  if (stats.rttMs >= VOICE_RTT || stats.loss >= VOICE_LOSS) return 'voice_low';
  if (stats.rttMs < FULL_RTT && stats.loss < FULL_LOSS) return 'full';
  return 'voice';
}

export function rank(level: VoiceLevel): number {
  return VOICE_LEVELS.indexOf(level);
}

/**
 * Hysteresis: DOWN immediately, UP only after the better level has held.
 *
 * Without this, a link sitting on a threshold flaps between levels every
 * sample, and the player hears the codec renegotiate every few seconds —
 * worse than simply staying at the lower level. Dropping fast is the safe
 * direction: it costs quality, while climbing too eagerly costs the call.
 *
 * @param upgradeStreak how many consecutive samples have justified the better
 *                      level, including this one.
 */
export const UPGRADE_SAMPLES = 3;

export function nextLevel(
  current: VoiceLevel,
  measured: VoiceLevel,
  upgradeStreak: number,
): VoiceLevel {
  if (rank(measured) < rank(current)) return measured;               // down: now
  if (rank(measured) > rank(current) && upgradeStreak >= UPGRADE_SAMPLES) {
    // Climb one step at a time, even when the measurement says "full": a link
    // that just recovered should prove itself at each rung.
    return VOICE_LEVELS[rank(current) + 1];
  }
  return current;
}

/** Audio publish settings for a level. 'text' publishes nothing at all. */
export function audioPreset(level: VoiceLevel): { bitrate: number; dtx: boolean } | null {
  switch (level) {
    case 'full':
    case 'voice':      return { bitrate: 24_000, dtx: false };
    case 'voice_low':  return { bitrate: 12_000, dtx: true };
    case 'text':       return null;
  }
}
