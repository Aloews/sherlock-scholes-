import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  levelFor, nextLevel, rank, audioPreset, VOICE_LEVELS, UPGRADE_SAMPLES,
  type VoiceLevel,
} from './voiceQuality';

describe('levelFor', () => {
  it('is full only on a fast, clean link', () => {
    expect(levelFor({ rttMs: 40, loss: 0 })).toBe('full');
    expect(levelFor({ rttMs: 149, loss: 0.019 })).toBe('full');
  });

  it('drops out of full the moment either threshold is crossed', () => {
    expect(levelFor({ rttMs: 150, loss: 0 })).toBe('voice');
    expect(levelFor({ rttMs: 40, loss: 0.02 })).toBe('voice');
  });

  it('is voice_low on a slow or lossy link', () => {
    expect(levelFor({ rttMs: 400, loss: 0 })).toBe('voice_low');
    expect(levelFor({ rttMs: 40, loss: 0.08 })).toBe('voice_low');
  });

  it('gives up on voice entirely at 20% loss, however fast the link', () => {
    expect(levelFor({ rttMs: 10, loss: 0.20 })).toBe('text');
  });

  it('handles the cross-continental case the feature exists for', () => {
    // Moscow to Buenos Aires: ~250 ms, a little loss.
    expect(levelFor({ rttMs: 250, loss: 0.03 })).toBe('voice');
  });

  it('never returns anything outside the ladder, for any input', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rttMs, loss) => {
          expect(VOICE_LEVELS).toContain(levelFor({ rttMs, loss }));
        },
      ),
    );
  });
});

describe('nextLevel — hysteresis', () => {
  it('drops immediately, without waiting for a streak', () => {
    expect(nextLevel('full', 'voice_low', 0)).toBe('voice_low');
    expect(nextLevel('full', 'text', 0)).toBe('text');
    expect(nextLevel('voice', 'text', 1)).toBe('text');
  });

  it('refuses to climb until the better level has held', () => {
    for (let streak = 0; streak < UPGRADE_SAMPLES; streak++) {
      expect(nextLevel('voice_low', 'full', streak)).toBe('voice_low');
    }
  });

  it('climbs one rung at a time, even when the link looks perfect', () => {
    // A link that jumps from text to "full" still has to walk up.
    expect(nextLevel('text', 'full', UPGRADE_SAMPLES)).toBe('voice_low');
    expect(nextLevel('voice_low', 'full', UPGRADE_SAMPLES)).toBe('voice');
    expect(nextLevel('voice', 'full', UPGRADE_SAMPLES)).toBe('full');
  });

  it('stays put when the measurement agrees with the current level', () => {
    for (const level of VOICE_LEVELS) {
      expect(nextLevel(level, level, 99)).toBe(level);
    }
  });

  it('never climbs past the measured level', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VOICE_LEVELS),
        fc.constantFrom(...VOICE_LEVELS),
        fc.integer({ min: 0, max: 50 }),
        (current, measured, streak) => {
          const next = nextLevel(current, measured, streak);
          const ceiling = Math.max(rank(current), rank(measured));
          expect(rank(next)).toBeLessThanOrEqual(ceiling);
        },
      ),
    );
  });

  it('cannot flap: a link pinned at one measurement settles and stays', () => {
    // Feed the same measurement repeatedly; the level must reach a fixed point
    // rather than oscillating, which is the bug hysteresis exists to prevent.
    let level: VoiceLevel = 'text';
    const measured: VoiceLevel = 'voice';
    const seen: VoiceLevel[] = [];
    for (let i = 0; i < 20; i++) {
      level = nextLevel(level, measured, UPGRADE_SAMPLES);
      seen.push(level);
    }
    expect(level).toBe('voice');
    // Once it arrives it never leaves.
    expect(seen.slice(-10).every((l) => l === 'voice')).toBe(true);
  });
});

describe('audioPreset', () => {
  it('publishes nothing in text mode', () => {
    expect(audioPreset('text')).toBeNull();
  });

  it('halves the bitrate and turns DTX on for a bad link', () => {
    const low = audioPreset('voice_low')!;
    const normal = audioPreset('voice')!;
    expect(low.bitrate).toBeLessThan(normal.bitrate);
    expect(low.dtx).toBe(true);
    expect(normal.dtx).toBe(false);
  });

  it('treats full and voice alike — this phase ships audio only', () => {
    expect(audioPreset('full')).toEqual(audioPreset('voice'));
  });
});
