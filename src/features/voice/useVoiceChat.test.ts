// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// "Пишет, что всё подключено, но ничего не слышно."
//
// The token was granted, LiveKit connected, the microphone was published —
// and the room was silent, because a subscribed track is not a played track.
// LiveKit hands the audio over and stops; attaching it to an element in the
// document is the application's job, and nothing here was doing it.
//
// These tests pin that job: that an incoming audio track ends up in an
// element the browser can play, that it leaves when the track does, and that
// a refused autoplay is reported rather than swallowed. Ten of the sixteen
// fail against the version that shipped; the other six guard the teardown,
// which could not be wrong yet because nothing was ever attached.

const RoomEvent = {
  ActiveSpeakersChanged: 'activeSpeakersChanged',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  AudioPlaybackStatusChanged: 'audioPlaybackChanged',
  Disconnected: 'disconnected',
} as const;

const lk = vi.hoisted(() => {
  /** Flipped before connect() to build a room that behaves a certain way. */
  const config = { refusePlayback: false, refuseMic: false, subscribeOnConnect: false };

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

  class FakeRoom {
    handlers = new Map<string, ((...args: never[]) => void)[]>();
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async (on: boolean) => {
        if (on && this.micRefused) throw new DOMException('denied', 'NotAllowedError');
      }),
    };
    canPlaybackAudio = true;
    startAudioCalls = 0;
    /** Where readLinkStats() digs for the WebRTC numbers. */
    engine: { pcManager: { publisher: { getStats: () => Promise<unknown> } } } | undefined;
    /** Makes startAudio() reject the way a blocked autoplay does. */
    playbackRefused = config.refusePlayback;

    on(event: string, cb: (...args: never[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
    }

    disconnectCalls = 0;
    /** Makes the microphone prompt refuse, the way a denied permission does. */
    micRefused = config.refuseMic;

    async connect() {
      // Autosubscribe: the other player's microphone arrives as part of
      // connecting, not at some later moment we control.
      if (config.subscribeOnConnect) this.emit('trackSubscribed', track());
    }
    async startAudio() {
      this.startAudioCalls += 1;
      if (this.playbackRefused) { this.canPlaybackAudio = false; throw new Error('blocked'); }
      this.canPlaybackAudio = true;
    }
    async disconnect() { this.disconnectCalls += 1; }
  }

  const rooms: FakeRoom[] = [];
  class TrackedRoom extends FakeRoom {
    constructor() { super(); rooms.push(this); }
  }
  return { config, rooms, track, TrackedRoom };
});

vi.mock('livekit-client', () => ({
  Room: lk.TrackedRoom,
  RoomEvent,
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
}));

const fetchVoiceToken = vi.fn();
vi.mock('./voiceApi', () => ({
  voiceEnabled: () => true,
  livekitUrl: () => 'wss://sherlok-1k9zd0ef.livekit.cloud',
  fetchVoiceToken: (...args: unknown[]) => fetchVoiceToken(...args),
}));

import { useVoiceChat } from './useVoiceChat';

const playing = () => document.querySelectorAll('audio');
const room = () => lk.rooms[lk.rooms.length - 1];

let release: (() => void) | null = null;

/** Connects a session the way a tap does, and hands back the live hook. */
async function connected() {
  const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
  release = unmount;
  await act(async () => { await result.current.connect(); });
  expect(result.current.status).toBe('on');
  return result;
}

beforeEach(() => {
  lk.rooms.length = 0;
  lk.config.refusePlayback = false;
  lk.config.refuseMic = false;
  lk.config.subscribeOnConnect = false;
  fetchVoiceToken.mockReset();
  fetchVoiceToken.mockResolvedValue({ ok: true, token: 'jwt.token.here', channel: 'ss_room-1' });
});

afterEach(() => {
  release?.();
  release = null;
  document.body.innerHTML = '';
});

describe('incoming audio', () => {
  it('plays the other player\'s microphone instead of dropping it', async () => {
    await connected();
    expect(playing()).toHaveLength(0);

    const track = lk.track();
    act(() => room().emit(RoomEvent.TrackSubscribed, track));

    // In the document, not merely created: an element nobody appended is an
    // element nobody hears, which is exactly what the bug looked like.
    expect(playing()).toHaveLength(1);
    expect(document.body.contains(playing()[0])).toBe(true);
  });

  it('gives every speaker their own element', async () => {
    await connected();
    act(() => {
      room().emit(RoomEvent.TrackSubscribed, lk.track());
      room().emit(RoomEvent.TrackSubscribed, lk.track());
    });
    expect(playing()).toHaveLength(2);
  });

  it('ignores tracks that are not audio', async () => {
    await connected();
    act(() => room().emit(RoomEvent.TrackSubscribed, lk.track('video')));
    expect(playing()).toHaveLength(0);
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });

  it('takes the element away when the track goes', async () => {
    await connected();
    const track = lk.track();
    act(() => room().emit(RoomEvent.TrackSubscribed, track));
    act(() => room().emit(RoomEvent.TrackUnsubscribed, track));
    expect(playing()).toHaveLength(0);
  });

  it('leaves nothing playing after a disconnect', async () => {
    const result = await connected();
    act(() => room().emit(RoomEvent.TrackSubscribed, lk.track()));
    act(() => result.current.disconnect());
    expect(playing()).toHaveLength(0);
    expect(result.current.status).toBe('off');
  });

  it('leaves nothing playing when the hook unmounts', async () => {
    await connected();
    act(() => room().emit(RoomEvent.TrackSubscribed, lk.track()));
    act(() => { release?.(); release = null; });
    expect(playing()).toHaveLength(0);
  });
});

describe('autoplay policy', () => {
  it('spends the connecting tap on starting playback', async () => {
    const result = await connected();
    expect(room().startAudioCalls).toBe(1);
    expect(result.current.audioBlocked).toBe(false);
  });

  it('reports a refusal rather than looking connected and silent', async () => {
    // A WebView that did not carry the gesture through: startAudio rejects.
    lk.config.refusePlayback = true;
    const result = await connected();

    // Still a live session — the link is fine, only the speaker is shut. That
    // distinction is the whole point: reconnecting would not fix this, and a
    // status of 'on' with no warning is what the customer was looking at.
    expect(result.current.status).toBe('on');
    expect(result.current.audioBlocked).toBe(true);
  });

  it('follows the browser when it changes its mind', async () => {
    const result = await connected();
    act(() => room().emit(RoomEvent.AudioPlaybackStatusChanged, false));
    expect(result.current.audioBlocked).toBe(true);
    act(() => room().emit(RoomEvent.AudioPlaybackStatusChanged, true));
    expect(result.current.audioBlocked).toBe(false);
  });

  it('clears the block when the player taps to allow it', async () => {
    const result = await connected();
    act(() => room().emit(RoomEvent.AudioPlaybackStatusChanged, false));
    expect(result.current.audioBlocked).toBe(true);

    await act(async () => { await result.current.startAudio(); });
    expect(room().startAudioCalls).toBe(2);
    expect(result.current.audioBlocked).toBe(false);
  });

  it('keeps the button when the tap did not take', async () => {
    const result = await connected();
    room().playbackRefused = true;
    await act(async () => { await result.current.startAudio(); });
    expect(result.current.audioBlocked).toBe(true);
  });

  it('does nothing when there is no session to unblock', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.startAudio(); });
    expect(result.current.audioBlocked).toBe(false);
    expect(lk.rooms).toHaveLength(0);
  });
});

describe('a connection that fails after the link came up', () => {
  // The microphone prompt is answered AFTER room.connect() has succeeded, so
  // "denied" arrives with a live room behind it. The old cleanup reached for
  // roomRef, which is only set once everything worked — so it disconnected
  // null and left the room open: still subscribed, still delivering audio,
  // under a screen that said the connection had failed.
  beforeEach(() => { lk.config.refuseMic = true; });

  it('reports the denial', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('denied');
  });

  it('closes the room it opened', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(room().disconnectCalls).toBe(1);
  });

  it('leaves nothing playing from tracks that arrived first', async () => {
    // Autosubscribe delivers on connect, before the prompt is answered — so
    // there is already audio in the document when the denial lands.
    lk.config.subscribeOnConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('denied');
    expect(playing()).toHaveLength(0);
  });
});

describe('the quality ladder and a muted player', () => {
  // The ladder runs on an interval created once, inside connect(). It used to
  // read `muted` out of that closure — the value AT CONNECT TIME, always
  // false. So the next time the level moved, the ladder called
  // setMicrophoneEnabled(true) and put a player who had muted themselves back
  // on air without a word. The microphone may be closed by the ladder; it may
  // never be opened by it.
  const stats = (rttMs: number, loss: number) => ({
    forEach(cb: (r: Record<string, unknown>) => void) {
      cb({ type: 'candidate-pair', currentRoundTripTime: rttMs / 1000 });
      cb({ type: 'outbound-rtp', packetsSent: 1000 });
      cb({ type: 'remote-inbound-rtp', packetsLost: Math.round(loss * 1000) });
    },
  });

  /** Runs enough ladder ticks for a level change to survive the streak rule. */
  async function tick(times: number) {
    for (let i = 0; i < times; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    }
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('leaves a muted player muted when the ladder moves', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    const mic = room().localParticipant.setMicrophoneEnabled;
    // A link good enough to carry voice, so the ladder wants the mic OPEN.
    room().engine = { pcManager: { publisher: { getStats: async () => stats(40, 0) } } };

    await act(async () => { await result.current.toggleMute(); });
    expect(result.current.muted).toBe(true);
    expect(mic).toHaveBeenLastCalledWith(false);

    await tick(4);
    // The ladder did run — it climbed a rung — and still left them muted.
    expect(result.current.level).toBe('full');
    expect(mic).toHaveBeenLastCalledWith(false);
    expect(result.current.muted).toBe(true);
  });
});
