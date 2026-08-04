import { useState, useRef, useCallback, useEffect } from 'react';

// The half of the voice channel a script cannot reach.
//
// `npm run check:voice` settles everything on the server. What it cannot touch
// is the device, and the device is where the last two unknowns live: whether
// Telegram's WebView hands over a microphone at all, and whether the browser
// will play what arrives. Both were guesses until now — the second one is the
// bug this whole area just spent three rounds on.
//
// So: a local loopback. Take the microphone, measure it, and play it back
// through exactly the same path a remote track takes — an <audio> element in
// the document, with play() watched for a refusal. No server, no provider, no
// room. If this works and a call still does not, the fault is upstream of the
// device; if this fails, it is the device, and it says which half.

export type SoundCheckStage = 'idle' | 'asking' | 'running' | 'denied' | 'failed';

export interface SoundCheck {
  stage: SoundCheckStage;
  /** 0..1, updated ~20×/s while running. The proof a microphone is live. */
  level: number;
  /** Peak seen this run — a level meter that only twitches proves nothing. */
  peak: number;
  /** The browser refused to play the loopback. The same refusal a call hits. */
  playbackBlocked: boolean;
  /** Whether the player is hearing themselves right now. */
  monitoring: boolean;
  start(): Promise<void>;
  stop(): void;
  toggleMonitor(): Promise<void>;
}

const SILENT = 0.02;

/**
 * A microphone, a meter and a loopback.
 *
 * Monitoring starts OFF. Playing a microphone back through a phone's speaker
 * is a feedback loop, and starting one without being asked is a nasty
 * surprise; the player turns it on when they want to hear themselves.
 */
export function useSoundCheck(): SoundCheck {
  const [stage, setStage] = useState<SoundCheckStage>('idle');
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [monitoring, setMonitoring] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const elRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    elRef.current?.pause();
    if (elRef.current) { elRef.current.srcObject = null; elRef.current.remove(); elRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setStage('idle');
    setLevel(0);
    setPeak(0);
    setMonitoring(false);
    setPlaybackBlocked(false);
  }, []);

  // A sound check left running is an open microphone, which is exactly what
  // the rest of this feature is careful never to leave behind.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    setStage('asking');
    setPeak(0);

    let stream: MediaStream;
    try {
      // The same constraints a call uses, so a device that fails here would
      // have failed there. Echo cancellation stays ON: turning it off to make
      // the meter prettier would be measuring something we do not ship.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const denied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      // Denied is a choice; anything else is a device that could not deliver —
      // no microphone, or a WebView that does not implement the ask.
      setStage(denied ? 'denied' : 'failed');
      return;
    }
    streamRef.current = stream;

    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('no AudioContext');
      const ctx = new Ctor();
      ctxRef.current = ctx;
      // Safari and Telegram's WebView hand back a suspended context; without
      // this the meter reads a flat zero and looks like a dead microphone.
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        // RMS, scaled so ordinary speech lands in the upper half of the bar
        // rather than hugging the floor.
        const rms = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        setLevel(rms);
        setPeak((p) => (rms > p ? rms : p));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setStage('running');
    } catch {
      // No meter is survivable — the loopback still answers the real question.
      setStage('running');
    }
  }, []);

  /**
   * Hear yourself.
   *
   * This is the check that matters: it goes through an <audio> element in the
   * document, which is the identical path a remote track takes. A refusal here
   * is the same refusal that made a connected room silent, and it is caught
   * the same way — by watching play() rather than assuming it.
   */
  const toggleMonitor = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;

    if (elRef.current) {
      elRef.current.pause();
      elRef.current.srcObject = null;
      elRef.current.remove();
      elRef.current = null;
      setMonitoring(false);
      return;
    }

    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.srcObject = stream;
    document.body.appendChild(el);
    elRef.current = el;
    setMonitoring(true);

    try {
      await Promise.resolve(el.play());
      setPlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
    }
  }, []);

  return { stage, level, peak, playbackBlocked, monitoring, start, stop, toggleMonitor };
}

/** Whether the meter has seen anything a listener would call sound. */
export function heardSomething(peak: number): boolean {
  return peak > SILENT;
}
