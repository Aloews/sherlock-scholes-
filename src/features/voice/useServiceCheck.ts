import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchCheckToken } from './voiceApi';
import { availableProviders, loadTransportFor, type VoiceProviderId } from './providers';
import { JOIN_TIMEOUT_MS } from './connectPolicy';
import type { LinkStats } from './voiceQuality';

/**
 * Does this phone's voice actually reach LiveKit, Daily and Agora?
 *
 * WHAT WAS WRONG WITH THE OLD CHECK. It took the microphone, metered it and
 * played it back through an <audio> element — device only, no network, no
 * vendor. It answered "is this microphone alive", which nobody was asking. The
 * question was whether the voice gets OUT, from this phone, on this network,
 * to each service in turn — and that had no answer anywhere in the app.
 *
 * WHAT THIS CANNOT DO, stated because the obvious reading of "проверить через
 * сервер" is the thing it is not. An SFU does not send you your own audio
 * back: you publish, and you subscribe to OTHERS. Alone in a channel there is
 * nothing to hear, and hearing yourself through Agora would need a bot sitting
 * in the room — infrastructure this project does not have. So this proves the
 * link, not the echo: the service accepted the credential, the connection came
 * up, and it reports a round trip. Hearing yourself stays a local loopback,
 * where it is honest (useSoundCheck).
 */

export type ServiceCheckOutcome = 'pending' | 'running' | 'reachable' | 'failed';

export interface ServiceCheckResult {
  provider: VoiceProviderId;
  outcome: ServiceCheckOutcome;
  /** What the link measured, when it came up. */
  stats: LinkStats | null;
  /** The service's own words, untranslated, when it did not. */
  detail: string | null;
}

export interface ServiceCheck {
  running: boolean;
  results: ServiceCheckResult[];
  run(): Promise<void>;
}

/** Long enough for a real handshake, short enough not to feel hung. */
const SETTLE_MS = 1200;

export function useServiceCheck(): ServiceCheck {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ServiceCheckResult[]>([]);
  // Set on unmount so a run that is mid-flight stops writing state and, more
  // importantly, still tears its session down.
  const goneRef = useRef(false);
  useEffect(() => () => { goneRef.current = true; }, []);
  // The guard has to be a ref, not the state above. Two taps in one tick both
  // read `running === false` — React has not re-rendered between them — and
  // both sweeps start. Two sweeps means two sessions per service at once, and
  // Daily allows exactly one call object per page: the diagnostic would break
  // the thing it was run to diagnose.
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);

    const providers = availableProviders();
    setResults(providers.map((provider) => ({
      provider, outcome: 'pending' as const, stats: null, detail: null,
    })));

    try {
      for (const provider of providers) {
        if (goneRef.current) return;
        setResults((rows) => rows.map((r) =>
          r.provider === provider ? { ...r, outcome: 'running' } : r));

        const result = await checkOne(provider);
        if (goneRef.current) return;
        setResults((rows) => rows.map((r) => (r.provider === provider ? result : r)));
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, []);

  return { running, results, run };
}

/**
 * One service, end to end: token, adapter, join, measure, leave.
 *
 * The teardown is in a `finally` for the same reason daily.ts grew one — a
 * session left open by a diagnostic is a microphone left open by a
 * diagnostic, and Daily's single call object would refuse every attempt after
 * it.
 */
async function checkOne(provider: VoiceProviderId): Promise<ServiceCheckResult> {
  const base = { provider, stats: null, detail: null } as const;

  const granted = await fetchCheckToken(provider);
  if (!granted.ok) {
    return { ...base, outcome: 'failed', detail: `token: ${granted.reason}` };
  }

  const sink = document.createElement('div');
  sink.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;';
  document.body.appendChild(sink);

  let session: Awaited<ReturnType<Awaited<ReturnType<typeof loadTransportFor>>['connect']>> | null = null;
  try {
    const transport = await loadTransportFor(granted.credentials.provider);
    session = await withDeadline(transport.connect({
      credentials: granted.credentials,
      sink,
      onSpeakers: () => {},
      // The check proves a voice channel comes up, and nothing about pictures:
      // it never opens a camera, so nothing is ever reported here.
      onVideoChanged: () => {},
      onPlaybackChanged: () => {},
      onDisconnected: () => {},
    }), JOIN_TIMEOUT_MS);

    // Publishing is the point. A connection that carries no audio is a
    // connection that proves nothing about a voice channel.
    await session.setMicrophoneEnabled(true);
    // Give the transport a moment to have something to measure — stats read
    // the instant after a join are empty on all three.
    await sleep(SETTLE_MS);
    const stats = await session.linkStats();

    return { provider, outcome: 'reachable', stats, detail: null };
  } catch (err) {
    return { ...base, outcome: 'failed', detail: messageOf(err) };
  } finally {
    await session?.disconnect().catch(() => {});
    sink.remove();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the service did not answer')), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Same reading as the session's own: not every SDK rejects with an Error. */
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const bag = err as Record<string, unknown>;
    for (const key of ['errorMsg', 'message', 'msg', 'reason']) {
      const value = bag[key];
      if (typeof value === 'string' && value) return value;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json.slice(0, 160);
    } catch { /* not serialisable */ }
  }
  return 'unknown error';
}
