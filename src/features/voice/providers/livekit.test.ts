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
    cameraCalls: { on: boolean; capture: unknown; publish: unknown }[] = [];
    /** What setCameraEnabled(true) hands back. Null models a refused camera. */
    cameraTrack: { attach(): HTMLVideoElement } | null = {
      attach: () => document.createElement('video'),
    };
    localParticipant = {
      identity: 'me',
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: async (on: boolean, capture: unknown, publish: unknown) => {
        this.cameraCalls.push({ on, capture, publish });
        return on && this.cameraTrack ? { videoTrack: this.cameraTrack } : undefined;
      },
    };
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
  Track: {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: { Camera: 'camera', ScreenShare: 'screen_share' },
  },
}));

import { livekitTransport } from './livekit';
import type { VoiceSession } from './types';

/** What LiveKit passes to TrackSubscribed: something that can attach itself. */
function track(kind: 'audio' | 'video' = 'audio', source = 'camera') {
  const attached: HTMLMediaElement[] = [];
  return {
    kind,
    source,
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

/** The other two arguments LiveKit hands to TrackSubscribed. */
function pub(sid = 'TR_1') { return { trackSid: sid }; }
function who(identity = '42') { return { identity }; }

let sink: HTMLElement;
const speakers = vi.fn();
const videos = vi.fn();
const playback = vi.fn();
const dropped = vi.fn();
const room = () => lk.rooms[lk.rooms.length - 1];
const playing = () => sink.querySelectorAll('audio');

function open(): Promise<VoiceSession> {
  return livekitTransport.connect({
    credentials: { provider: 'livekit', token: 'jwt', channel: 'ss_room-1', url: 'wss://example' },
    sink,
    onSpeakers: speakers,
    onVideoChanged: videos,
    onPlaybackChanged: playback,
    onDisconnected: dropped,
  });
}

beforeEach(() => {
  lk.rooms.length = 0;
  lk.config.failConnect = false;
  speakers.mockReset();
  videos.mockReset();
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

    room().emit(RoomEvent.TrackSubscribed, track(), pub(), who());

    // In the sink, not merely created: an element nobody appended is an
    // element nobody hears, which is exactly what the bug looked like.
    expect(playing()).toHaveLength(1);
    expect(sink.contains(playing()[0])).toBe(true);
  });

  it('gives every speaker their own element', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track(), pub(), who());
    room().emit(RoomEvent.TrackSubscribed, track(), pub(), who());
    expect(playing()).toHaveLength(2);
  });

  // A picture is not audio and must not end up in the audio sink — that node
  // is a hidden zero-sized div, so a <video> parked there is a camera nobody
  // can see and a track nobody stops paying for.
  it('keeps pictures out of the audio sink', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub(), who());
    expect(playing()).toHaveLength(0);
    expect(sink.querySelectorAll('video')).toHaveLength(0);
  });

  it('takes the element away when the track goes', async () => {
    await open();
    const t = track();
    room().emit(RoomEvent.TrackSubscribed, t, pub(), who());
    room().emit(RoomEvent.TrackUnsubscribed, t, pub());
    expect(playing()).toHaveLength(0);
  });

  it('empties the sink on disconnect, even if no unsubscribe arrives', async () => {
    const session = await open();
    room().emit(RoomEvent.TrackSubscribed, track(), pub(), who());
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
      onVideoChanged: videos,
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

// ─── Pictures ───────────────────────────────────────────────────────────────
//
// Video arrives through the same TrackSubscribed event as audio and is the one
// thing that must NOT go into the audio sink — that node is a hidden,
// zero-sized div, so a <video> parked there is a camera nobody can see and a
// track nobody stops paying for. The adapter therefore reports pictures out
// through onVideoChanged and lets the layout decide where they live.
describe('incoming pictures', () => {
  const feeds = () => videos.mock.calls[videos.mock.calls.length - 1]?.[0] ?? [];

  it('reports a remote camera with the identity behind it', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub('TR_9'), who('777'));
    expect(feeds()).toHaveLength(1);
    expect(feeds()[0].identity).toBe('777');
    expect(feeds()[0].element.tagName).toBe('VIDEO');
  });

  // Autoplay on a phone is refused SILENTLY without these: the element sits in
  // the layout showing nothing, and no error is raised anywhere to explain it.
  it('marks the element the way a mobile browser requires', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub(), who());
    const el = feeds()[0].element as HTMLVideoElement;
    expect(el.playsInline).toBe(true);
    expect(el.autoplay).toBe(true);
    expect(el.muted).toBe(true);
  });

  // A screen share carries the card the explainer is looking at. The token
  // withholds the source, and this is the second lock on the same door.
  it('drops anything that is not the camera', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video', 'screen_share'), pub(), who());
    expect(feeds()).toHaveLength(0);
  });

  // Keyed by track, not by participant: two video tracks from one person must
  // not silently replace each other, leaving an element nothing will detach.
  it('keeps two tracks from one participant apart', async () => {
    await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub('TR_1'), who('42'));
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub('TR_2'), who('42'));
    expect(feeds()).toHaveLength(2);
  });

  it('takes the picture away when the track goes', async () => {
    await open();
    const t = track('video');
    room().emit(RoomEvent.TrackSubscribed, t, pub('TR_1'), who());
    room().emit(RoomEvent.TrackUnsubscribed, t, pub('TR_1'));
    expect(feeds()).toHaveLength(0);
  });

  // A frozen last frame is how a call that ended goes on looking live.
  it('clears every picture on disconnect', async () => {
    const session = await open();
    room().emit(RoomEvent.TrackSubscribed, track('video'), pub(), who());
    await session.disconnect();
    expect(feeds()).toHaveLength(0);
  });
});

describe('the local camera', () => {
  it('publishes small, and without simulcast', async () => {
    const session = await open();
    await session.setCameraEnabled(true);
    const call = room().cameraCalls[0];
    expect(call.on).toBe(true);
    // 320×240 at 15fps is the handoff's `full` rung. Asking for more would
    // spend the same phone battery to arrive at the same size, later.
    expect(call.capture).toMatchObject({ resolution: { width: 320, height: 240 } });
    expect(call.publish).toMatchObject({ simulcast: false });
  });

  it('hands back a muted, mirrored-ready self-view', async () => {
    const session = await open();
    const feed = await session.setCameraEnabled(true);
    expect(feed?.identity).toBe('me');
    // The self-view is this device's microphone coming back out of this
    // device's speaker if it is not muted.
    expect((feed?.element as HTMLVideoElement).muted).toBe(true);
  });

  it('says nothing came up when the camera was refused', async () => {
    const session = await open();
    room().cameraTrack = null;
    // Not a throw: LiveKit resolves happily and simply publishes nothing. Null
    // is what lets the hook put the button back out instead of lighting it
    // over a dead camera.
    await expect(session.setCameraEnabled(true)).resolves.toBeNull();
  });

  it('answers null when it is switched off', async () => {
    const session = await open();
    await session.setCameraEnabled(true);
    await expect(session.setCameraEnabled(false)).resolves.toBeNull();
    expect(room().cameraCalls[1].on).toBe(false);
  });
});
