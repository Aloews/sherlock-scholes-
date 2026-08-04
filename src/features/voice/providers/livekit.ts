// LiveKit adapter.
//
// The SDK is imported dynamically and only from here: it is ~550 KB, and a
// deployment on another provider — or on none — must not carry it. See
// providers/index.ts for how the unselected adapters leave the bundle.

import type { VoiceConnectOptions, VoiceSession, VoiceTransport } from './types';
import type { LinkStats } from '../voiceQuality';
import type { Room } from 'livekit-client';

export const livekitTransport: VoiceTransport = {
  id: 'livekit',

  async connect(options: VoiceConnectOptions): Promise<VoiceSession> {
    const { url, token } = options.credentials;
    if (!url) throw new Error('livekit: no server address (VITE_LIVEKIT_URL)');

    const { Room: LKRoom, RoomEvent, Track } = await import('livekit-client');
    const room = new LKRoom({ adaptiveStream: false, dynacast: true });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      options.onSpeakers(speakers.map((s) => s.identity));
    });

    // A subscribed track is not a played track. LiveKit hands the audio over
    // and stops there; attach() builds the <audio> element, and putting it in
    // the document is ours to do. Skipping this is what "connected but nothing
    // is audible" looks like from the outside — see
    // docs/LOBBY_AND_VOICE_FIXES.md §3.
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      options.sink.appendChild(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      track.detach().forEach((el) => el.remove());
    });

    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      options.onPlaybackChanged(room.canPlaybackAudio);
    });

    let leaving = false;
    room.on(RoomEvent.Disconnected, () => { if (!leaving) options.onDisconnected(); });

    await room.connect(url, token);

    return {
      async setMicrophoneEnabled(on) {
        await room.localParticipant.setMicrophoneEnabled(on);
      },
      async startAudio() {
        await room.startAudio();
      },
      canPlaybackAudio() {
        return room.canPlaybackAudio;
      },
      linkStats() {
        return readLinkStats(room);
      },
      async disconnect() {
        leaving = true;
        // Belt and braces: Disconnected normally unsubscribes every track,
        // but a session torn down mid-handshake may never emit it, and an
        // <audio> element left in the sink keeps playing.
        options.sink.replaceChildren();
        await room.disconnect();
      },
    };
  },
};

/** RTT and loss from the publisher's WebRTC stats, averaged by the browser. */
async function readLinkStats(room: Room): Promise<LinkStats | null> {
  try {
    const stats = await room.engine?.pcManager?.publisher?.getStats?.();
    if (!stats) return null;
    let rttMs = 0;
    let lost = 0;
    let sent = 0;
    stats.forEach((report: { type: string; currentRoundTripTime?: number; packetsLost?: number; packetsSent?: number }) => {
      if (report.type === 'candidate-pair' && typeof report.currentRoundTripTime === 'number') {
        rttMs = report.currentRoundTripTime * 1000;
      }
      if (report.type === 'remote-inbound-rtp') {
        lost += report.packetsLost ?? 0;
      }
      if (report.type === 'outbound-rtp') {
        sent += report.packetsSent ?? 0;
      }
    });
    return { rttMs, loss: sent > 0 ? Math.max(0, Math.min(1, lost / sent)) : 0 };
  } catch {
    return null;
  }
}
