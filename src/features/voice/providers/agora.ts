// Agora adapter.
//
// Agora differs from the other two in three ways that matter here:
//
//   * The token is minted for an EXACT uid. Joining as anything else is
//     rejected, so `credentials.identity` is not a hint — it is part of the
//     credential, and the server chooses it.
//   * The app id is a separate public value from the token. It travels with
//     the grant so one place decides which Agora project a room belongs to.
//   * Playback is the SDK's own: `audioTrack.play()` creates and owns the
//     element. There is nothing to put in the sink, so the sink stays empty
//     and autoplay is reported through `onAudioAutoplayFailed` instead.
//
// THE CHANNEL COMES UP BEFORE THE MICROPHONE IS ASKED FOR. That order is
// Agora's, not ours — publish needs a joined client — and it means every
// failure from `createMicrophoneAudioTrack` onwards happens with a live
// connection behind it. The teardown at the bottom of connect() exists for
// exactly that: without it a player who refused the microphone stayed in the
// channel, hearing everyone, under a screen saying they had not joined.
//
// STATUS: written against agora-rtc-sdk-ng's client API (`createClient`,
// `join`, `publish`, `user-published`/`user-unpublished`, `volume-indicator`,
// `getRTCStats`), and covered by agora.test.ts.
//
// The tests held the SHAPE of every call and still let a dead adapter ship:
// they mocked createClient, so nothing in the suite had an opinion about the
// VALUE of `codec`, and the SDK rejects it (see AGORA_VIDEO_CODECS below). A
// real device found it in one tap of the service check. Where a value has to
// come from the vendor's vocabulary rather than ours, the test now pins the
// value, not just the call.

import type { VoiceConnectOptions, VoiceSession, VoiceTransport } from './types';

/** Only the parts of agora-rtc-sdk-ng this adapter uses. */
interface AgoraUser {
  uid: string | number;
  audioTrack?: { play(): void; stop(): void };
}

interface AgoraClient {
  join(appId: string, channel: string, token: string | null, uid?: string | number | null): Promise<string | number>;
  leave(): Promise<void>;
  publish(tracks: unknown[]): Promise<void>;
  subscribe(user: AgoraUser, mediaType: 'audio' | 'video'): Promise<void>;
  enableAudioVolumeIndicator(): void;
  getRTCStats(): { RTT?: number; OutgoingAvailableBandwidth?: number };
  on(event: string, handler: (...args: never[]) => void): void;
}

interface AgoraMicTrack {
  setEnabled(on: boolean): Promise<void>;
  close(): void;
}

/**
 * The only codecs `createClient` accepts.
 *
 * `codec` is Agora's VIDEO codec, and there is no audio equivalent to set —
 * the SDK negotiates Opus for audio on its own. This adapter passed 'opus'
 * here, which is an audio codec, and the SDK answers:
 *
 *   AgoraRTCError INVALID_PARAMS: config.codec can only be set as
 *   ["vp8","vp9","av1","h264","h265"]
 *
 * thrown out of createClient — before join, before the microphone, before
 * anything this file does. Agora therefore never connected once, on any
 * device, since the adapter was written; the failover ladder had a third rung
 * that could not hold weight. Named as a constant so a future edit has to
 * argue with the list rather than guess at it again.
 */
export const AGORA_VIDEO_CODECS = ['vp8', 'vp9', 'av1', 'h264', 'h265'] as const;
export type AgoraVideoCodec = (typeof AGORA_VIDEO_CODECS)[number];

/**
 * What we ask for. The call is audio-only — no video track is ever created —
 * so the value only has to be one the SDK accepts, and vp8 is its own default
 * and the most widely supported.
 */
export const AGORA_CODEC: AgoraVideoCodec = 'vp8';

interface AgoraSdk {
  createClient(opts: { mode: string; codec: AgoraVideoCodec }): AgoraClient;
  createMicrophoneAudioTrack(): Promise<AgoraMicTrack>;
  onAudioAutoplayFailed?: (() => void) | null;
}

export const agoraTransport: VoiceTransport = {
  id: 'agora',

  async connect(options: VoiceConnectOptions): Promise<VoiceSession> {
    const { token, channel, appId, identity } = options.credentials;
    if (!appId) throw new Error('agora: the server did not return an app id');

    const mod = await import('agora-rtc-sdk-ng');
    const AgoraRTC = (mod.default ?? mod) as unknown as AgoraSdk;

    const client = AgoraRTC.createClient({ mode: 'rtc', codec: AGORA_CODEC });

    let blocked = false;
    let leaving = false;
    let mic: AgoraMicTrack | null = null;

    try {
      // The SDK owns the elements, so this is the only way to learn that the
      // browser refused them. Without it a blocked channel is indistinguishable
      // from a quiet one. It is a GLOBAL on the module, not a per-session
      // handler, which is why the teardown below has to take it back down.
      AgoraRTC.onAudioAutoplayFailed = () => {
        blocked = true;
        options.onPlaybackChanged(false);
      };

      client.on('user-published', (async (user: AgoraUser, mediaType: 'audio' | 'video') => {
        if (mediaType !== 'audio') return;
        await client.subscribe(user, mediaType);
        user.audioTrack?.play();
      }) as (...args: never[]) => void);

      client.on('user-unpublished', ((user: AgoraUser, mediaType: 'audio' | 'video') => {
        if (mediaType !== 'audio') return;
        user.audioTrack?.stop();
      }) as (...args: never[]) => void);

      client.enableAudioVolumeIndicator();
      client.on('volume-indicator', ((levels: { uid: string | number; level: number }[]) => {
        // Agora reports everyone with a level, loud or not; the ladder wants
        // only who is actually speaking.
        options.onSpeakers(levels.filter((l) => l.level > 5).map((l) => String(l.uid)));
      }) as (...args: never[]) => void);

      client.on('connection-state-change', ((state: string) => {
        if (state === 'DISCONNECTED' && !leaving) options.onDisconnected();
      }) as (...args: never[]) => void);

      // The uid is part of what the token signs. `identity ?? null` rather than
      // a generated one: a mismatch here is rejected by Agora, and silently
      // picking our own would turn a server decision into a client guess.
      await client.join(appId, channel, token || null, identity ?? null);

      mic = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([mic]);

      const track = mic;
      return {
        async setMicrophoneEnabled(on) {
          await track.setEnabled(on);
        },
        async startAudio() {
          // There is no element to replay: the SDK retries its own on the next
          // gesture, and this call exists so the UI can clear the warning once
          // the browser has stopped refusing.
          blocked = false;
          options.onPlaybackChanged(true);
        },
        canPlaybackAudio() {
          return !blocked;
        },
        async linkStats() {
          try {
            const rtt = client.getRTCStats()?.RTT;
            if (typeof rtt !== 'number' || Number.isNaN(rtt)) return null;
            // Agora's client stats carry latency but no publisher loss ratio.
            // Zero is honest here: the ladder drops on RTT alone.
            return { rttMs: rtt, loss: 0 };
          } catch {
            return null;
          }
        },
        async disconnect() {
          leaving = true;
          AgoraRTC.onAudioAutoplayFailed = null;
          track.close();
          options.sink.replaceChildren();
          await client.leave().catch(() => {});
        },
      };
    } catch (err) {
      // THE MICROPHONE IS ASKED FOR AFTER THE CHANNEL IS UP, so a refusal
      // arrives with a live connection behind it. Nothing above can clean that
      // up: useVoiceChat only ever sees the session connect() returns, and
      // this connect() is not returning one. Left alone, the player sits in a
      // channel they were told they had not joined — subscribed, hearing
      // everyone — which is the LiveKit bug of docs/LOBBY_AND_VOICE_FIXES.md
      // §3, in a third adapter.
      leaving = true;
      AgoraRTC.onAudioAutoplayFailed = null;
      mic?.close();
      options.sink.replaceChildren();
      await client.leave().catch(() => {});
      throw err;
    }
  },
};
