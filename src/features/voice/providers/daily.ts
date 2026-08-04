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
// STATUS: written against the daily-js call-object API (`createCallObject`,
// `join`, `track-started`/`track-stopped`, `active-speaker-change`,
// `setLocalAudio`, `getNetworkStats`). Not yet exercised against a live Daily
// account — `npm run check:voice` verifies the server half, and the first real
// session is what confirms the rest.

import type { VoiceConnectOptions, VoiceSession, VoiceTransport } from './types';
import type { LinkStats } from '../voiceQuality';
import { AudioSink } from './audioSink';

/** Only the parts of daily-js this adapter uses, so the SDK's types stay optional. */
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

  async connect(options: VoiceConnectOptions): Promise<VoiceSession> {
    const { url, token } = options.credentials;
    if (!url) throw new Error('daily: the server did not return a room URL');

    const mod = await import('@daily-co/daily-js');
    const Daily = (mod.default ?? mod) as { createCallObject(opts: unknown): DailyCall };

    const call = Daily.createCallObject({
      audioSource: true,
      // Audio only, decided here as well as on the server: a client that asks
      // for a camera should not get one just because the token allowed it.
      videoSource: false,
      subscribeToTracksAutomatically: true,
    });

    const sink = new AudioSink(options.sink, options.onPlaybackChanged);

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

    let leaving = false;
    call.on('left-meeting', () => { if (!leaving) options.onDisconnected(); });
    call.on('error', () => { if (!leaving) options.onDisconnected(); });

    await call.join({ url, token: token || undefined });

    return {
      async setMicrophoneEnabled(on) {
        call.setLocalAudio(on);
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
