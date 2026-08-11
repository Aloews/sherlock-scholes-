// LiveKit adapter.
//
// The SDK is imported dynamically and only from here: it is ~550 KB, and a
// deployment on another provider — or on none — must not carry it. See
// providers/index.ts for how the unselected adapters leave the bundle.

import type { VideoFeed, VoiceConnectOptions, VoiceSession, VoiceTransport } from './types';
import type { LinkStats } from '../voiceQuality';
import type { Room } from 'livekit-client';

/**
 * What the camera publishes, when it publishes at all.
 *
 * 320×240 at 15 fps is the handoff's `full` rung (docs/VIDEOCHAT_HANDOFF.md
 * §3), and it is deliberately small. Players are on different continents; the
 * uplink is a phone; and the picture in this game is a face beside a card, not
 * a thing anyone reads detail from. Asking for 720p and letting the SFU throttle
 * it down would spend the same battery to arrive at the same size, later.
 *
 * Simulcast is off for the same reason: layers below 320×240 buy nothing, and
 * each one is another encoder running on the phone.
 */
const CAMERA_CAPTURE = { resolution: { width: 320, height: 240, frameRate: 15 } };
const CAMERA_PUBLISH = {
  simulcast: false,
  videoEncoding: { maxBitrate: 150_000, maxFramerate: 15 },
};

export const livekitTransport: VoiceTransport = {
  id: 'livekit',
  video: true,

  async connect(options: VoiceConnectOptions): Promise<VoiceSession> {
    const { url, token } = options.credentials;
    if (!url) throw new Error('livekit: no server address (VITE_LIVEKIT_URL)');

    const { Room: LKRoom, RoomEvent, Track } = await import('livekit-client');
    const room = new LKRoom({ adaptiveStream: false, dynacast: true });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      options.onSpeakers(speakers.map((s) => s.identity));
    });

    // Remote pictures, keyed by TRACK rather than by participant. A participant
    // can hold more than one video track — camera and screen share look alike
    // from here — and keying by identity would let the second silently replace
    // the first, leaving an element in the layout that nothing will ever
    // detach.
    const feeds = new Map<string, VideoFeed>();
    const publishFeeds = () => options.onVideoChanged([...feeds.values()]);

    // A subscribed track is not a played track. LiveKit hands the audio over
    // and stops there; attach() builds the <audio> element, and putting it in
    // the document is ours to do. Skipping this is what "connected but nothing
    // is audible" looks like from the outside — see
    // docs/LOBBY_AND_VOICE_FIXES.md §3.
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        options.sink.appendChild(track.attach());
        return;
      }
      if (track.kind !== Track.Kind.Video) return;
      // Only the camera. The token withholds every other source, so a screen
      // share cannot arrive — but reading the source rather than trusting that
      // keeps the two decisions independent.
      if (track.source !== Track.Source.Camera) return;
      const element = track.attach() as HTMLVideoElement;
      // A phone will refuse to play an inline video without these, and refuse
      // silently: the element sits in the layout showing the first frame, or
      // nothing at all.
      element.playsInline = true;
      element.autoplay = true;
      element.muted = true;
      feeds.set(publication.trackSid, { identity: participant.identity, element });
      publishFeeds();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
        return;
      }
      if (track.kind !== Track.Kind.Video) return;
      track.detach().forEach((el) => el.remove());
      if (feeds.delete(publication.trackSid)) publishFeeds();
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
      async setCameraEnabled(on) {
        const publication = await room.localParticipant.setCameraEnabled(
          on,
          CAMERA_CAPTURE,
          CAMERA_PUBLISH,
        );
        if (!on) return null;
        // A publication with no track is what a REFUSED camera looks like:
        // setCameraEnabled resolves, and there is simply nothing to show. Null
        // is the honest answer — the caller turns the button back off rather
        // than leaving an empty tile on screen.
        const track = publication?.videoTrack;
        if (!track) return null;
        const element = track.attach() as HTMLVideoElement;
        element.playsInline = true;
        element.autoplay = true;
        // The local preview must never be audible: it is this device's own
        // microphone coming back out of this device's own speaker.
        element.muted = true;
        return { identity: room.localParticipant.identity, element };
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
        // Same for the pictures — an <video> the component still holds keeps
        // showing the last frame of a call that ended.
        for (const feed of feeds.values()) feed.element.remove();
        feeds.clear();
        publishFeeds();
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
