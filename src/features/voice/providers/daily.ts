// Daily.co adapter.
//
// Daily's unit is a ROOM URL, not an address plus a channel name: the server
// creates the room and the meeting token together, so `credentials.url` is the
// room itself and `channel` is only its name. That is why the grant carries a
// URL at all — see providers/types.ts.
//
// Daily hands over raw MediaStreamTracks and leaves the elements to us, so the
// remote audio goes through AudioSink, which is also where a refused autoplay
// stops being an unhandled promise rejection.
//
// ONE CALL OBJECT PER PAGE. Daily refuses a second with "Duplicate DailyIframe
// instances are not allowed", and it refuses it at creation — so a call object
// that leaks does not break its own attempt, it breaks every attempt after it
// until the page is reloaded. This adapter used to leak one on any failure
// between createCallObject and the session it returns, because the object is
// reachable only through that session. Production spent a week showing the
// duplicate error, which is the SECOND failure repeated, with the first one
// gone. Hence the teardown on the throwing path and the sweep before creating.

import type { VoiceConnectOptions, VoiceSession, VoiceTransport } from './types';
import type { LinkStats } from '../voiceQuality';
import { AudioSink } from './audioSink';

/** Only the parts of daily-js this adapter uses, so the SDK's types stay optional. */
interface DailyFactory {
  createCallObject(opts: unknown): DailyCall;
  /** Optional: absent in older daily-js, and the sweep below is best-effort. */
  getCallInstance?(): DailyCall | undefined | null;
}

interface DailyCall {
  join(opts: { url: string; token?: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy(): Promise<unknown>;
  setLocalAudio(on: boolean): unknown;
  getNetworkStats(): Promise<DailyNetworkStats>;
  on(event: string, handler: (ev: DailyEvent) => void): unknown;
}

interface DailyEvent {
  track?: MediaStreamTrack;
  participant?: { local?: boolean; session_id?: string; user_id?: string };
  activeSpeaker?: { peerId?: string };
}

interface DailyNetworkStats {
  stats?: { latest?: { videoRecvPacketLoss?: number; totalRecvPacketLoss?: number; timestamp?: number } };
  latest?: { recvPacketLoss?: number };
}

export const dailyTransport: VoiceTransport = {
  id: 'daily',
  // Audio only here. Daily carries video perfectly well; this adapter never
  // asked for it, and the token minted for it sets `start_video_off`. The flag
  // describes THIS ADAPTER, not the vendor — see types.ts.
  video: false,

  async connect(options: VoiceConnectOptions): Promise<VoiceSession> {
    const { url, token } = options.credentials;
    if (!url) throw new Error('daily: the server did not return a room URL');

    const mod = await import('@daily-co/daily-js');
    const Daily = (mod.default ?? mod) as DailyFactory;

    // Anything left over from a previous attempt would make createCallObject
    // throw below, so the leftover — not this attempt — would be the failure
    // reported. Clear it first: whatever it is, nothing holds it any more.
    await sweepLeftoverInstance(Daily);

    const call = Daily.createCallObject({
      audioSource: true,
      // Audio only, decided here as well as on the server: a client that asks
      // for a camera should not get one just because the token allowed it.
      videoSource: false,
      subscribeToTracksAutomatically: true,
    });

    const sink = new AudioSink(options.sink, options.onPlaybackChanged);
    let leaving = false;

    try {
      call.on('track-started', (ev) => {
        const track = ev.track;
        if (!track || track.kind !== 'audio' || ev.participant?.local) return;
        sink.add(participantKey(ev), track);
      });
      call.on('track-stopped', (ev) => {
        if (ev.track?.kind !== 'audio' || ev.participant?.local) return;
        sink.remove(participantKey(ev));
      });
      call.on('participant-left', (ev) => sink.remove(participantKey(ev)));

      call.on('active-speaker-change', (ev) => {
        const id = ev.activeSpeaker?.peerId;
        // Daily reports one speaker at a time; the ladder above wants a set.
        options.onSpeakers(id ? [id] : []);
      });

      call.on('left-meeting', () => { if (!leaving) options.onDisconnected(); });
      call.on('error', () => { if (!leaving) options.onDisconnected(); });

      await call.join({ url, token: token || undefined });
    } catch (err) {
      // The call object escapes this function only inside the session below.
      // Failing without destroying it strands Daily's one allowed instance and
      // poisons every later attempt — the bug this whole comment block is about.
      leaving = true;
      sink.clear();
      await call.leave().catch(() => {});
      await call.destroy().catch(() => {});
      throw err;
    }

    return {
      async setMicrophoneEnabled(on) {
        call.setLocalAudio(on);
      },
      // Refuses rather than resolves. `video: false` above is what callers are
      // meant to read; reaching this line is a bug upstream, and a silent
      // no-op would hide it behind a camera button that lights up and does
      // nothing.
      setCameraEnabled() {
        return Promise.reject(new Error('daily: this adapter is audio only'));
      },
      async startAudio() {
        await sink.start();
      },
      canPlaybackAudio() {
        return sink.canPlay();
      },
      async linkStats() {
        return readLinkStats(call);
      },
      async disconnect() {
        leaving = true;
        sink.clear();
        await call.leave().catch(() => {});
        await call.destroy().catch(() => {});
      },
    };
  },
};

/**
 * Destroys a call object nobody owns any more.
 *
 * Only ever reached when a previous attempt stranded one; the fix above means
 * that should no longer happen, and this stays because "should no longer" is
 * not the same as "cannot", and the cost of being wrong is a voice channel
 * that is dead until the app is restarted. Best-effort throughout: an SDK
 * without `getCallInstance`, or one that refuses to tear down, must not turn
 * a working connect into a failure.
 */
async function sweepLeftoverInstance(Daily: DailyFactory): Promise<void> {
  try {
    const existing = Daily.getCallInstance?.();
    if (!existing) return;
    await existing.leave().catch(() => {});
    await existing.destroy().catch(() => {});
  } catch { /* nothing to sweep, or an SDK that will not say */ }
}

function participantKey(ev: DailyEvent): string {
  return ev.participant?.session_id ?? ev.participant?.user_id ?? 'remote';
}

/**
 * Daily reports loss but not round-trip time in the shape the ladder wants.
 *
 * Reporting RTT 0 rather than guessing is deliberate: `levelFor` treats loss
 * on its own as enough to drop a level, so the ladder still works — it just
 * has one fewer reason to fire. Inventing a latency figure would move the
 * level on a number nobody measured.
 */
async function readLinkStats(call: DailyCall): Promise<LinkStats | null> {
  try {
    const stats = await call.getNetworkStats();
    const loss = stats?.stats?.latest?.totalRecvPacketLoss ?? stats?.latest?.recvPacketLoss;
    if (typeof loss !== 'number' || Number.isNaN(loss)) return null;
    return { rttMs: 0, loss: Math.max(0, Math.min(1, loss)) };
  } catch {
    return null;
  }
}
