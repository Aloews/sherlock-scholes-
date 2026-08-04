// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// "Пишет, что всё подключено, но ничего не слышно."
//
// The token was granted, LiveKit connected, the microphone was published —
// and the room was silent, because a subscribed track is not a played track.
// LiveKit hands the audio over and stops; attaching it to an element in the
// document is the application's job, and nothing was doing it
// (docs/LOBBY_AND_VOICE_FIXES.md §3).
//
// These tests hold the adapter to that job. They live at the adapter level
// rather than the hook's because this is the half that is LiveKit-shaped:
// every other provider attaches audio differently, and only this one has
// attach()/detach() to get wrong.

const RoomEvent = {
  ActiveSpeakersChanged: 'activeSpeakersChanged',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  AudioPlaybackStatusChanged: 'audioPlaybackChanged',
  Disconnected: 'disconnected',
} as const;

const lk = vi.hoisted(() => {
  const config = { failConnect: false };

  class FakeRoom {
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => {}) };
    canPlaybackAudio = true;
    startAudioCalls = 0;
    disconnectCalls = 0;
    engine: { pcManager: { publisher: { getStats: () => Promise<unknown> } } } | undefined;

    on(event: string, cb: (...args: never[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
    }

    async connect() { if (config.failConnect) throw new Error('no link'); }
    async startAudio() { this.startAudioCalls += 1; }
    async disconnect() { this.disconnectCalls += 1; }
  }

  const rooms: FakeRoom[] = [];
  class TrackedRoom extends FakeRoom {
    constructor() { super(); rooms.push(this); }
  }
  return { config, rooms, TrackedRoom };
});

vi.mock('livekit-client', () => ({
  Room: lk.TrackedRoom,
  RoomEvent,
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
}));

import { livekitTransport } from './livekit';
import type { VoiceSession } from './types';

/** What LiveKit passes to TrackSubscribed: something that can attach itself. */
function track(kind: 'audio' | 'video' = 'audio') {
  const attached: HTMLMediaElement[] = [];
  return {
    kind,
    attach() {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      attached.push(el);
      return el;
    },
    detach() {
      const out = [...attached];
      attached.length = 0;
      return out;
    },
  };
}

let sink: HTMLElement;
const speakers = vi.fn();
const playback = vi.fn();
const dropped = vi.fn();
const room = () => lk.rooms[lk.rooms.length - 1];
const playing = () => sink.querySelectorAll('audio');

function open(): Promise<VoiceSession> {
  return livekitTransport.connect({
    credentials: { provider: 'livekit', token: 'jwt', channel: 'ss_room-1', url: 'wss://example' },
    sink,
    onSpeakers: speakers,
    onPlaybackChanged: playback,
    onDisconnected: dropped,
  });
}

beforeEach(() => {
  lk.rooms.length = 0;
  lk.config.failConnect = false;
  speakers.mockReset();
  playback.mockReset();
  dropped.mockReset();
  sink = document.createElement('div');
  document.body.appendChild(sink);
});

afterEach(() => { document.body.innerHTML = ''; });

describe('incoming audio', () => {
  it('plays the other player\'s microphone instead of dropping it', async () => {
    await open();
    expect(playing()).toHaveLength(0);

    room().emit(RoomEvent.TrackSubscribed, track());

    // In the sink, not merely created: an element nobody appended is an
    // element nobody hears, which is exactly what the bug looked like.
    expect(playing()).toHaveLength(1);
    expect(sink.contains(playing()[0])).toBe(true);
  });

  it('gives every speaker their own element', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track());
    room().emit(RoomEvent.TrackSubscribed, track());
    expect(playing()).toHaveLength(2);
  });

  it('ignores tracks that are not audio', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'));
    expect(playing()).toHaveLength(0);
    expect(sink.querySelectorAll('video')).toHaveLength(0);
  });

  it('takes the element away when the track goes', async () => {
    await open();
    const t = track();
    room().emit(RoomEvent.TrackSubscribed, t);
    room().emit(RoomEvent.TrackUnsubscribed, t);
    expect(playing()).toHaveLength(0);
  });

  it('empties the sink on disconnect, even if no unsubscribe arrives', async () => {
    const session = await open();
    room().emit(RoomEvent.TrackSubscribed, track());
    await session.disconnect();
    expect(playing()).toHaveLength(0);
    expect(room().disconnectCalls).toBe(1);
  });
});

describe('the session it hands back', () => {
  it('reports who is speaking', async () => {
    await open();
    room().emit(RoomEvent.ActiveSpeakersChanged, [{ identity: '11' }, { identity: '22' }]);
    expect(speakers).toHaveBeenCalledWith(['11', '22']);
  });

  it('passes the microphone through', async () => {
    const session = await open();
    await session.setMicrophoneEnabled(false);
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it('reports playback the browser refused, and the recovery', async () => {
    const session = await open();
    room().canPlaybackAudio = false;
    room().emit(RoomEvent.AudioPlaybackStatusChanged);
    expect(playback).toHaveBeenLastCalledWith(false);
    expect(session.canPlaybackAudio()).toBe(false);

    room().canPlaybackAudio = true;
    await session.startAudio();
    expect(room().startAudioCalls).toBe(1);
    expect(session.canPlaybackAudio()).toBe(true);
  });

  it('reads RTT and loss for the ladder', async () => {
    const session = await open();
    room().engine = {
      pcManager: {
        publisher: {
          getStats: async () => ({
            forEach(cb: (r: Record<string, unknown>) => void) {
              cb({ type: 'candidate-pair', currentRoundTripTime: 0.2 });
              cb({ type: 'outbound-rtp', packetsSent: 1000 });
              cb({ type: 'remote-inbound-rtp', packetsLost: 50 });
            },
          }),
        },
      },
    };
    expect(await session.linkStats()).toEqual({ rttMs: 200, loss: 0.05 });
  });

  it('says nothing rather than guessing when there are no stats', async () => {
    const session = await open();
    expect(await session.linkStats()).toBeNull();
  });
});

describe('who is told the link dropped', () => {
  it('reports a drop that happened to us', async () => {
    await open();
    room().emit(RoomEvent.Disconnected);
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when we are the ones leaving', async () => {
    // Otherwise a deliberate hang-up bounces back through the hook's
    // onDisconnected and tears down state that is already being torn down.
    const session = await open();
    await session.disconnect();
    room().emit(RoomEvent.Disconnected);
    expect(dropped).not.toHaveBeenCalled();
  });
});

describe('what it refuses to do', () => {
  it('will not connect without an address', async () => {
    await expect(livekitTransport.connect({
      credentials: { provider: 'livekit', token: 'jwt', channel: 'c' },
      sink,
      onSpeakers: speakers,
      onPlaybackChanged: playback,
      onDisconnected: dropped,
    })).rejects.toThrow(/VITE_LIVEKIT_URL/);
    expect(lk.rooms).toHaveLength(0);
  });

  it('lets a failed connect surface instead of returning a dead session', async () => {
    lk.config.failConnect = true;
    await expect(open()).rejects.toThrow('no link');
  });
});
