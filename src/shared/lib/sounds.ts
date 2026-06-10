// Web Audio synth — every sound is generated in code at play time, so there
// are no audio files to ship and nothing copyrighted. The on/off flag is
// settingsStore.soundEnabled (persisted), shared with the home-screen toggle.

import { useSettingsStore } from '@/shared/store/settingsStore';

export type SoundName =
  | 'tick' | 'correct' | 'skip' | 'gong' | 'swipe'
  | 'whistle_start' | 'whistle_end' | 'kick' | 'applause' | 'fanfare';

// Deliberately quiet master level: button feedback, not jingles.
const MASTER = 0.15;

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Mobile browsers create the context suspended until a user gesture; all
  // our sounds fire from click handlers, so resuming here is allowed.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

interface ToneOpts {
  freq: number;
  at?: number;            // seconds from now
  dur?: number;
  type?: OscillatorType;
  gain?: number;          // 0..1, scaled by MASTER
  glideTo?: number;       // optional pitch-glide target (Hz)
  trillHz?: number;       // vibrato rate — the "pea" of a referee whistle
  trillDepth?: number;    // vibrato depth (Hz)
}

function tone(
  ac: AudioContext,
  { freq, at = 0, dur = 0.1, type = 'sine', gain = 1, glideTo, trillHz, trillDepth }: ToneOpts,
): void {
  const t0  = ac.currentTime + at;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  }
  if (trillHz && trillDepth) {
    // LFO -> osc.frequency: fast shallow FM reads as a whistle trill.
    const lfo = ac.createOscillator();
    const lfoAmp = ac.createGain();
    lfo.frequency.setValueAtTime(trillHz, t0);
    lfoAmp.gain.setValueAtTime(trillDepth, t0);
    lfo.connect(lfoAmp).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.02);
  }
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain * MASTER, t0 + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Referee whistle: ~2 kHz tone with a fast shallow trill.
function whistle(
  ac: AudioContext,
  opts: { at?: number; dur?: number; freq?: number; gain?: number; glideTo?: number },
): void {
  tone(ac, {
    freq: opts.freq ?? 2000,
    at: opts.at,
    dur: opts.dur ?? 0.12,
    gain: opts.gain ?? 0.5,
    glideTo: opts.glideTo,
    trillHz: 38,
    trillDepth: 70,
  });
}

interface NoiseOpts {
  at?: number;
  dur?: number;
  freq?: number;          // bandpass centre (Hz)
  glideTo?: number;
  q?: number;
  gain?: number;
}

function noise(
  ac: AudioContext,
  { at = 0, dur = 0.15, freq = 1000, glideTo, q = 1, gain = 1 }: NoiseOpts,
): void {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0  = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq, t0);
  if (glideTo !== undefined) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  }
  bp.Q.value = q;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain * MASTER, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(amp).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const SOUNDS: Record<SoundName, (ac: AudioContext) => void> = {
  // Countdown blip for the last seconds of a round.
  tick: (ac) => tone(ac, { freq: 1500, dur: 0.04, type: 'square', gain: 0.35 }),

  // "Guessed" — stadium "goal!": ascending major two-tone plus a wide
  // white-noise swell underneath, the crowd roar. ~250ms total.
  correct: (ac) => {
    tone(ac, { freq: 523.25, dur: 0.12, type: 'triangle', gain: 0.9 });            // C5
    tone(ac, { freq: 659.25, at: 0.08, dur: 0.17, type: 'triangle', gain: 0.9 });  // E5
    noise(ac, { dur: 0.25, freq: 900, q: 0.4, gain: 0.5 });                        // трибуна
  },

  // "Skip" — single short referee peep, ~2 kHz with a light trill.
  skip: (ac) => whistle(ac, { freq: 2000, dur: 0.12, gain: 0.45 }),

  // "Pass turn" — ball kick: dull low thump, fast decay.
  swipe: (ac) => tone(ac, { freq: 150, dur: 0.08, gain: 1 }),

  // Time's up — low decaying strike with a quiet fifth on top.
  gong: (ac) => {
    tone(ac, { freq: 196, dur: 0.7, gain: 0.9 });
    tone(ac, { freq: 294, dur: 0.5, gain: 0.35 });
  },

  // Round start — referee double whistle: two short trilled peeps.
  whistle_start: (ac) => {
    whistle(ac, { freq: 2100, dur: 0.09, gain: 0.5 });
    whistle(ac, { freq: 2100, at: 0.15, dur: 0.11, gain: 0.5 });
  },

  // Round over — one longer falling trilled peep.
  whistle_end: (ac) => whistle(ac, { freq: 2300, glideTo: 1800, dur: 0.3, gain: 0.5 }),

  // Ball thump.
  kick: (ac) => tone(ac, { freq: 150, glideTo: 50, dur: 0.12, gain: 1 }),

  // Three quick muffled noise claps.
  applause: (ac) => {
    noise(ac, { dur: 0.1, freq: 1800, q: 0.8, gain: 0.4 });
    noise(ac, { at: 0.08, dur: 0.1, freq: 2200, q: 0.8, gain: 0.35 });
    noise(ac, { at: 0.16, dur: 0.14, freq: 1600, q: 0.8, gain: 0.3 });
  },

  // Game over — final long referee whistle, then a three-note mini fanfare.
  fanfare: (ac) => {
    whistle(ac, { freq: 2100, dur: 0.45, gain: 0.45 });                             // финальный свисток
    tone(ac, { freq: 523.25, at: 0.5,  dur: 0.14, type: 'triangle', gain: 0.85 });  // C5
    tone(ac, { freq: 659.25, at: 0.64, dur: 0.14, type: 'triangle', gain: 0.85 });  // E5
    tone(ac, { freq: 783.99, at: 0.78, dur: 0.35, type: 'triangle', gain: 0.95 });  // G5
  },
};

// Kept for the in-game mute button — both delegate to settingsStore, so the
// game-screen button and the home-screen toggle always stay in sync.
export function isMuted(): boolean {
  return !useSettingsStore.getState().soundEnabled;
}

export function toggleMute(): void {
  const { soundEnabled, setSoundEnabled } = useSettingsStore.getState();
  setSoundEnabled(!soundEnabled);
}

export function playSound(name: SoundName): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const ac = getContext();
  if (!ac) return;
  try {
    SOUNDS[name](ac);
  } catch {
    // Web Audio unavailable or scheduling failed — stay silent.
  }
}
