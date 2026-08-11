// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The session, with the service faked out.
//
// Everything provider-shaped now lives in providers/ and is tested there
// (providers/livekit.test.ts holds the "connected but nothing is audible"
// regression). What is left here is what the hook itself owes the game: a
// place for remote audio that exists while a call does and not afterwards, a
// blocked autoplay reported rather than swallowed, a muted player who stays
// muted, and a failed connect that closes what it opened.

const fake = vi.hoisted(() => {
  const config = {
    refuseMic: false, refusePlayback: false, failConnect: false, attachOnConnect: false,
    /** The camera resolves, and publishes nothing — a device already in use. */
    refuseCamera: false,
  };

  class FakeSession {
    micCalls: boolean[] = [];
    startAudioCalls = 0;
    disconnectCalls = 0;
    playable = true;
    stats: { rttMs: number; loss: number } | null = null;
    /** The sink the hook handed over — the adapter's only way to be heard. */
    sink: HTMLElement | null = null;

    cameraCalls: boolean[] = [];

    async setMicrophoneEnabled(on: boolean) {
      this.micCalls.push(on);
      if (on && config.refuseMic) throw new DOMException('denied', 'NotAllowedError');
    }
    async setCameraEnabled(on: boolean) {
      this.cameraCalls.push(on);
      if (!on || config.refuseCamera) return null;
      return { identity: 'me', element: document.createElement('video') };
    }
    async startAudio() {
      this.startAudioCalls += 1;
      if (config.refusePlayback) { this.playable = false; throw new Error('blocked'); }
      this.playable = true;
    }
    canPlaybackAudio() { return this.playable; }
    async linkStats() { return this.stats; }
    async disconnect() { this.disconnectCalls += 1; }

    /** Stands in for a track arriving: something lands in the sink. */
    play() { this.sink?.appendChild(document.createElement('audio')); }
  }

  const sessions: FakeSession[] = [];
  const hooks: {
    speakers?: (ids: string[]) => void;
    videos?: (feeds: { identity: string; element: HTMLVideoElement }[]) => void;
    playback?: (playing: boolean) => void;
    dropped?: () => void;
  } = {};

  /** Services this build carries, and which one it prefers. */
  const build = {
    preferred: 'livekit' as string,
    available: ['livekit'] as string[],
    /** Services whose join throws, so the ladder has something to walk past. */
    refuse: new Set<string>(),
    /** Services whose adapter chunk will not load at all. */
    unloadable: new Set<string>(),
    /** The order loadTransportFor was asked for, which is the ladder itself. */
    asked: [] as string[],
    /** Whether the adapter this build loads declares it carries pictures. */
    video: true,
  };

  function transportFor(id: string) {
    if (build.unloadable.has(id)) throw new Error(`${id}: chunk failed`);
    return {
      id,
      video: build.video,
      async connect(options: {
        sink: HTMLElement;
        onSpeakers: (ids: string[]) => void;
        onVideoChanged: (feeds: { identity: string; element: HTMLVideoElement }[]) => void;
        onPlaybackChanged: (playing: boolean) => void;
        onDisconnected: () => void;
      }) {
        if (config.failConnect || build.refuse.has(id)) throw new Error(`no link (${id})`);
        const session = new FakeSession();
        session.sink = options.sink;
        hooks.speakers = options.onSpeakers;
        hooks.videos = options.onVideoChanged;
        hooks.playback = options.onPlaybackChanged;
        hooks.dropped = options.onDisconnected;
        sessions.push(session);
        if (config.attachOnConnect) session.play();
        return session;
      },
    };
  }

  return { config, sessions, hooks, build, transportFor };
});

vi.mock('./providers', () => ({
  loadTransportFor: async (id: string) => {
    fake.build.asked.push(id);
    return fake.transportFor(id);
  },
  availableProviders: () => fake.build.available,
  voiceProvider: () => fake.build.preferred,
  voiceProviderMisconfigured: () => false,
  VOICE_PROVIDER_IDS: ['livekit', 'daily', 'agora'],
}));

const fetchVoiceToken = vi.fn();
vi.mock('./voiceApi', () => ({
  voiceEnabled: () => true,
  livekitUrl: () => 'wss://sherlok-1k9zd0ef.livekit.cloud',
  fetchVoiceToken: (...args: unknown[]) => fetchVoiceToken(...args),
}));

import { useVoiceChat } from './useVoiceChat';

const playing = () => document.querySelectorAll('audio');
const session = () => fake.sessions[fake.sessions.length - 1];

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
  fake.sessions.length = 0;
  fake.config.refuseMic = false;
  fake.config.refusePlayback = false;
  fake.config.failConnect = false;
  fake.config.attachOnConnect = false;
  fake.config.refuseCamera = false;
  fake.build.video = true;
  fake.build.preferred = 'livekit';
  fake.build.available = ['livekit'];
  fake.build.refuse.clear();
  fake.build.unloadable.clear();
  fake.build.asked.length = 0;
  fetchVoiceToken.mockReset();
  // The server signs for whichever service it was asked for (#54), so the
  // credential's provider follows the argument rather than a fixed value.
  fetchVoiceToken.mockImplementation(async (_roomId: string, provider = 'livekit') => ({
    ok: true,
    credentials: { provider, token: 'jwt.token.here', channel: 'ss_room-1', url: 'wss://example' },
  }));
});

afterEach(() => {
  release?.();
  release = null;
  document.body.innerHTML = '';
});

describe('the place remote audio goes', () => {
  it('hands the adapter a sink that is already in the document', async () => {
    await connected();
    expect(session().sink).not.toBeNull();
    // An element outside the document is an element nobody hears — the
    // failure this whole seam exists to prevent.
    expect(document.body.contains(session().sink)).toBe(true);
  });

  it('leaves nothing playing after a disconnect', async () => {
    const result = await connected();
    act(() => session().play());
    expect(playing()).toHaveLength(1);

    act(() => result.current.disconnect());
    expect(playing()).toHaveLength(0);
    expect(session().disconnectCalls).toBe(1);
    expect(result.current.status).toBe('off');
  });

  it('leaves nothing playing when the hook unmounts', async () => {
    await connected();
    act(() => session().play());
    act(() => { release?.(); release = null; });
    expect(playing()).toHaveLength(0);
  });

  it('reuses one sink across reconnects instead of stacking them', async () => {
    const result = await connected();
    act(() => result.current.disconnect());
    await act(async () => { await result.current.connect(); });
    expect(document.querySelectorAll('[data-voice-sink]')).toHaveLength(1);
  });
});

describe('autoplay policy', () => {
  it('spends the connecting tap on starting playback', async () => {
    const result = await connected();
    expect(session().startAudioCalls).toBe(1);
    expect(result.current.audioBlocked).toBe(false);
  });

  it('reports a refusal rather than looking connected and silent', async () => {
    fake.config.refusePlayback = true;
    const result = await connected();

    // Still a live session — the link is fine, only the speaker is shut. That
    // distinction is the whole point: reconnecting would not fix this, and a
    // status of 'on' with no warning is what the customer was looking at.
    expect(result.current.status).toBe('on');
    expect(result.current.audioBlocked).toBe(true);
  });

  it('follows the adapter when the browser changes its mind', async () => {
    const result = await connected();
    act(() => fake.hooks.playback?.(false));
    expect(result.current.audioBlocked).toBe(true);
    act(() => fake.hooks.playback?.(true));
    expect(result.current.audioBlocked).toBe(false);
  });

  it('clears the block when the player taps to allow it', async () => {
    const result = await connected();
    act(() => fake.hooks.playback?.(false));
    expect(result.current.audioBlocked).toBe(true);

    await act(async () => { await result.current.startAudio(); });
    expect(session().startAudioCalls).toBe(2);
    expect(result.current.audioBlocked).toBe(false);
  });

  it('keeps the button when the tap did not take', async () => {
    const result = await connected();
    fake.config.refusePlayback = true;
    await act(async () => { await result.current.startAudio(); });
    expect(result.current.audioBlocked).toBe(true);
  });

  it('does nothing when there is no session to unblock', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.startAudio(); });
    expect(result.current.audioBlocked).toBe(false);
    expect(fake.sessions).toHaveLength(0);
  });
});

describe('a connection that fails after the link came up', () => {
  // The microphone prompt is answered AFTER the transport has connected, so
  // "denied" arrives with a live session behind it. Cleanup that reached for
  // the ref — only set once everything worked — disconnected null and left
  // the session open: still subscribed, still delivering audio, under a
  // screen that said the connection had failed.
  beforeEach(() => { fake.config.refuseMic = true; });

  it('reports the denial', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('denied');
  });

  it('closes the session it opened', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(session().disconnectCalls).toBe(1);
  });

  it('leaves nothing playing from tracks that arrived first', async () => {
    fake.config.attachOnConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('denied');
    expect(playing()).toHaveLength(0);
  });

  // The token was granted, so this is the SERVICE failing, not the server —
  // and which part of the service matters. "network" used to cover a refused
  // join, a silent one and a chunk that would not load; on production that
  // ambiguity cost a week.
  it('names a refused join rather than blaming the network', async () => {
    fake.config.refuseMic = false;
    fake.config.failConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('join_failed');
  });

  it("quotes the service's own words, so the failure can be searched for", async () => {
    fake.config.refuseMic = false;
    fake.config.failConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.detail).toMatch(/no link/i);
  });
});

describe('what the server refused', () => {
  it('carries the reason through instead of one shared silence', async () => {
    fetchVoiceToken.mockResolvedValue({ ok: false, reason: 'no_team_yet' });
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('no_team_yet');
    expect(fake.sessions).toHaveLength(0);
  });
});

// Auto-connect fires from an effect; the button fires from a tap; neither
// knows about the other. The guard used to be `sessionRef`, which is null for
// the whole of an attempt — so both got through and each built a client.
// Daily allows exactly one per page and refuses the second, which is how a
// race turned into a voice channel that was dead until the app restarted.
describe('one attempt at a time', () => {
  it('ignores a second connect while the first is still in flight', async () => {
    let letTokenThrough!: () => void;
    const held = new Promise<void>((resolve) => { letTokenThrough = resolve; });
    fetchVoiceToken.mockImplementationOnce(async () => {
      await held;
      return {
        ok: true,
        credentials: { provider: 'livekit', token: 'jwt', channel: 'ss_room-1', url: 'wss://example' },
      };
    });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;

    await act(async () => {
      const first = result.current.connect();
      const second = result.current.connect();
      letTokenThrough();
      await Promise.all([first, second]);
    });

    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
    expect(fake.sessions).toHaveLength(1);
    expect(result.current.status).toBe('on');
  });

  // The guard has to come back off on every path, or one failure means no
  // voice for the rest of the session — a worse bug than the one it fixes.
  it('lets the next attempt run after a failure', async () => {
    fake.config.failConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;

    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('unavailable');

    fake.config.failConnect = false;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('on');
  });
});

// Three services, tried in turn. The interesting half is where the ladder
// refuses to walk: a player who said no to the microphone must not be asked
// twice more, and a room they are not in will be refused by all three.
describe('walking to the next service', () => {
  const allThree = () => {
    fake.build.available = ['livekit', 'daily', 'agora'];
    fake.build.preferred = 'livekit';
  };

  it('takes a refused join to the next service and connects there', async () => {
    allThree();
    fake.build.refuse.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.active).toBe('daily');
    expect(fake.build.asked).toEqual(['livekit', 'daily']);
  });

  it('starts with the service the build prefers', async () => {
    allThree();
    fake.build.preferred = 'agora';
    fake.build.refuse.add('agora');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fake.build.asked[0]).toBe('agora');
    expect(result.current.active).toBe('livekit');
  });

  it('walks past an adapter whose chunk will not load', async () => {
    allThree();
    fake.build.unloadable.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.active).toBe('daily');
  });

  // Every service refusing is still one failure to report, and the one worth
  // reporting is the first — the service this deployment actually chose.
  it('keeps the first service’s reason when they all refuse', async () => {
    allThree();
    for (const id of ['livekit', 'daily', 'agora']) fake.build.refuse.add(id);

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('join_failed');
    expect(result.current.detail).toMatch(/livekit/);
    expect(fake.build.asked).toEqual(['livekit', 'daily', 'agora']);
    // Every rung is recorded, so the panel can say which spares are gone.
    expect(Object.keys(result.current.tried).sort()).toEqual(['agora', 'daily', 'livekit']);
  });

  // THE ONE THAT MUST NOT REGRESS. A microphone the player refused is an
  // answer, and a ladder that keeps going asks for it again on the next
  // vendor — three prompts for one "no".
  it('stops the whole ladder when the player refuses the microphone', async () => {
    allThree();
    fake.config.refuseMic = true;

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('denied');
    expect(fake.build.asked).toEqual(['livekit']);
  });

  it('does not shop around for a room the player is not in', async () => {
    allThree();
    fetchVoiceToken.mockResolvedValue({ ok: false, reason: 'not_in_room' });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.reason).toBe('not_in_room');
    expect(fake.build.asked).toEqual([]);
    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
  });

  it('does not shop around when our own token function is unreachable', async () => {
    allThree();
    fetchVoiceToken.mockResolvedValue({ ok: false, reason: 'network' });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.reason).toBe('network');
    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
  });

  // A build without VITE_VOICE_FALLBACK carries one adapter, and must behave
  // exactly as it did before any of this existed.
  it('tries exactly one service when only one is compiled in', async () => {
    fake.build.available = ['livekit'];
    fake.build.refuse.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(fake.build.asked).toEqual(['livekit']);
  });

  it('asks the server to sign for the service it is about to try', async () => {
    allThree();
    fake.build.refuse.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fetchVoiceToken).toHaveBeenNthCalledWith(1, 'room-1', 'livekit', null);
    expect(fetchVoiceToken).toHaveBeenNthCalledWith(2, 'room-1', 'daily', 'livekit');
  });
});

// A channel exists inside one vendor. Two players on two services are in two
// different rooms while both screens read "Связь есть" and neither hears
// anything — the one failure shape that looks like success. The room decides,
// server-side, and the client's job is to do as it is told.
describe('the service the room already agreed on', () => {
  const allThree = () => {
    fake.build.available = ['livekit', 'daily', 'agora'];
    fake.build.preferred = 'livekit';
  };

  /** The server signs for `pinned` no matter what the caller asks for. */
  const roomPinnedTo = (pinned: string) => {
    fetchVoiceToken.mockImplementation(async () => ({
      ok: true,
      credentials: { provider: pinned, token: 'jwt', channel: 'ss_room-1', url: 'wss://example' },
    }));
  };

  it('loads the service the server signed for, not the one it asked for', async () => {
    allThree();
    roomPinnedTo('agora');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.active).toBe('agora');
  });

  // The whole point of obeying: one round trip, not three. Refusing the
  // mismatch used to walk livekit → daily → agora to reach the answer the
  // first response already carried.
  it('gets there in one attempt instead of walking the ladder', async () => {
    allThree();
    roomPinnedTo('agora');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
    expect(fake.build.asked).toEqual(['agora']);
  });

  it('still refuses when the room is on a service this build cannot load', async () => {
    fake.build.available = ['livekit'];
    fake.build.preferred = 'livekit';
    roomPinnedTo('agora');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('provider_mismatch');
    expect(fake.build.asked).toEqual([]);
  });

  // Being sent somewhere else must not cost the ladder its remaining rungs:
  // the room's service failing is still a reason to try the next one.
  it('keeps walking when the room’s own service will not come up', async () => {
    allThree();
    roomPinnedTo('daily');
    fake.build.refuse.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fake.build.asked[0]).toBe('daily');
    expect(fake.build.asked.length).toBeGreaterThan(1);
  });

  // OBEYING THE ROOM CAN NEUTER THE LADDER. The server signs for the pinned
  // service every time, so a client walking to the next rung is handed the
  // same dead vendor again — three attempts, one service, no failover left.
  // The way out is not to stop obeying: it is to tell the server the service
  // is dead, so the ROOM moves and everyone moves with it.
  it('asks the server to move the room off a service that will not come up', async () => {
    allThree();
    fake.build.refuse.add('daily');

    // A server that honours a reported failure by moving the room.
    let pinned = 'daily';
    fetchVoiceToken.mockImplementation(async (
      _roomId: string,
      provider: string,
      failed?: string,
    ) => {
      if (failed && failed === pinned && provider !== pinned) pinned = provider;
      return {
        ok: true,
        credentials: { provider: pinned, token: 'jwt', channel: 'ss_room-1', url: 'wss://example' },
      };
    });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    // Not three attempts on daily: the room was moved and the second attempt
    // landed somewhere that works.
    expect(fake.build.asked).toEqual(['daily', 'livekit']);
    expect(result.current.active).toBe('livekit');
  });

  it('names the service that actually failed, not the one it asked for', async () => {
    allThree();
    roomPinnedTo('daily');
    fake.build.refuse.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    // Attempt 2 asks for livekit and reports that DAILY is what died — the
    // service it was actually handed, not the rung it was standing on.
    expect(fetchVoiceToken).toHaveBeenNthCalledWith(2, 'room-1', 'livekit', 'daily');
    // And the panel blames daily, which is the one a person can go and look at.
    expect(result.current.tried.daily?.reason).toBe('join_failed');
  });
});

// A link that dies mid-game is the ordinary case, not the exception: phones
// change networks, lock, and lose the room. The player is holding one device
// and explaining a card — nothing here may need a tap.
describe('a link that dies in the middle of a game', () => {
  it('reports the drop as a session that is simply off again', async () => {
    const result = await connected();
    act(() => fake.hooks.dropped?.());

    // 'off' rather than 'unavailable' on purpose: nothing refused us, so
    // auto-connect is free to try again immediately (connectPolicy.ts).
    expect(result.current.status).toBe('off');
    expect(result.current.reason).toBeNull();
  });

  it('leaves nothing playing behind when the link drops', async () => {
    const result = await connected();
    act(() => session().play());
    act(() => fake.hooks.dropped?.());
    expect(playing()).toHaveLength(0);
    expect(result.current.status).toBe('off');
  });

  it('comes back on the same service when that service is healthy', async () => {
    fake.build.available = ['livekit', 'daily', 'agora'];
    const result = await connected();
    act(() => fake.hooks.dropped?.());

    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('on');
    expect(result.current.active).toBe('livekit');
  });

  // The reconnect is a fresh climb, so a service that has since died is walked
  // past exactly as it would be on a first join.
  it('changes service when the old one will not take it back', async () => {
    fake.build.available = ['livekit', 'daily', 'agora'];
    const result = await connected();
    act(() => fake.hooks.dropped?.());

    fake.build.refuse.add('livekit');
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.active).toBe('daily');
  });

  it('forgets the previous round’s failures when it reconnects', async () => {
    fake.build.available = ['livekit', 'daily', 'agora'];
    fake.build.refuse.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.tried.livekit).toBeTruthy();

    act(() => result.current.disconnect());
    fake.build.refuse.clear();
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.tried).toEqual({});
  });
});

describe('the quality ladder and a muted player', () => {
  // The ladder runs on an interval created once, inside connect(). It used to
  // read `muted` out of that closure — the value AT CONNECT TIME, always
  // false. So the next time the level moved, the ladder called
  // setMicrophoneEnabled(true) and put a player who had muted themselves back
  // on air without a word. The microphone may be closed by the ladder; it may
  // never be opened by it.

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

    // A link good enough to carry voice, so the ladder wants the mic OPEN.
    session().stats = { rttMs: 40, loss: 0 };

    await act(async () => { await result.current.toggleMute(); });
    expect(result.current.muted).toBe(true);
    expect(session().micCalls.at(-1)).toBe(false);

    await tick(4);
    // The ladder did run — it climbed a rung — and still left them muted.
    expect(result.current.level).toBe('full');
    expect(session().micCalls.at(-1)).toBe(false);
    expect(result.current.muted).toBe(true);
  });

  it('closes the microphone when the link cannot carry voice at all', async () => {
    const result = await connected();
    session().stats = { rttMs: 900, loss: 0.5 };
    await tick(2);
    expect(result.current.level).toBe('text');
    expect(session().micCalls.at(-1)).toBe(false);
  });
});

// Production showed "[object Object]" under the Daily row — in the one place
// built to quote the service word for word. Not every SDK rejects with an
// Error, and String() on a plain object says nothing while looking like an
// answer.
describe('quoting a service that did not throw an Error', () => {
  // Swapping the transport out is heavier than the other fakes here, so it is
  // put back afterwards rather than left for the next file to trip over.
  const realTransportFor = fake.transportFor;
  afterEach(() => { fake.transportFor = realTransportFor; });

  it.each([
    [{ errorMsg: 'Meeting has ended' }, /Meeting has ended/],
    [{ message: 'not allowed' }, /not allowed/],
    [{ msg: 'token expired' }, /token expired/],
    [{ error: { msg: 'nested reason' } }, /nested reason/],
    ['a plain string', /a plain string/],
    [new Error('an ordinary error'), /an ordinary error/],
  ])('reads %o', async (thrown, expected) => {
    fake.build.available = ['livekit'];
    fake.transportFor = () => ({
      id: 'livekit',
      video: true,
      async connect() { throw thrown; },
    });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.detail).toMatch(expected);
  });

  it('never shows the string that says nothing', async () => {
    fake.build.available = ['livekit'];
    fake.transportFor = () => ({
      id: 'livekit',
      video: true,
      async connect() { throw { weird: true, nested: { deep: 1 } }; },
    });

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.detail).not.toBe('[object Object]');
    // Ugly JSON is searchable; "[object Object]" is not.
    expect(result.current.detail).toMatch(/weird/);
  });
});

// ─── The camera ─────────────────────────────────────────────────────────────
//
// Video is a passenger, never a peer: it is offered only where the service
// carries it, opened only on a tap, and closed by the ladder the moment the
// link stops deserving it. What these hold is the difference between what the
// player ASKED for and what is actually on the wire — the pair that lets a
// camera survive a bad patch instead of being forgotten by it.
describe('the camera', () => {
  it('is not offered by a service that has no pictures', async () => {
    fake.build.video = false;
    const result = await connected();
    expect(result.current.videoSupported).toBe(false);

    // And the tap is a no-op rather than a throw: an audio-only adapter
    // rejects setCameraEnabled, and the hook must never reach it.
    await act(async () => { await result.current.toggleCamera(); });
    expect(session().cameraCalls).toEqual([]);
    expect(result.current.cameraOn).toBe(false);
  });

  it('starts closed on every connection', async () => {
    const result = await connected();
    expect(result.current.videoSupported).toBe(true);
    expect(result.current.cameraOn).toBe(false);
    expect(result.current.selfFeed).toBeNull();
    expect(session().cameraCalls).toEqual([]);
  });

  it('opens on a tap and hands back a self-view', async () => {
    const result = await connected();
    await act(async () => { await result.current.toggleCamera(); });
    expect(result.current.cameraOn).toBe(true);
    expect(result.current.selfFeed?.element.tagName).toBe('VIDEO');
    expect(session().cameraCalls).toEqual([true]);
  });

  it('closes again on the next tap', async () => {
    const result = await connected();
    await act(async () => { await result.current.toggleCamera(); });
    await act(async () => { await result.current.toggleCamera(); });
    expect(result.current.cameraOn).toBe(false);
    expect(result.current.selfFeed).toBeNull();
    expect(session().cameraCalls).toEqual([true, false]);
  });

  // A lit button over a dead camera is the same lie as a connected room with
  // no audio, which is the failure this whole feature was built out of.
  it('puts the button back out when the camera will not open', async () => {
    const result = await connected();
    fake.config.refuseCamera = true;
    await act(async () => { await result.current.toggleCamera(); });
    expect(result.current.cameraOn).toBe(false);
    expect(result.current.selfFeed).toBeNull();
  });

  it('shows what the service sends', async () => {
    const result = await connected();
    const feed = { identity: '777', element: document.createElement('video') };
    act(() => { fake.hooks.videos?.([feed]); });
    expect(result.current.feeds).toEqual([feed]);
  });

  it('leaves no picture behind when the call ends', async () => {
    const result = await connected();
    await act(async () => { await result.current.toggleCamera(); });
    act(() => { fake.hooks.videos?.([{ identity: '777', element: document.createElement('video') }]); });

    act(() => { result.current.disconnect(); });
    expect(result.current.feeds).toEqual([]);
    expect(result.current.selfFeed).toBeNull();
    expect(result.current.cameraOn).toBe(false);
  });
});

describe('the quality ladder and the camera', () => {
  // VIDEO GOES FIRST (docs/VIDEOCHAT_HANDOFF.md §2): the picture is sacrificed
  // before the audio bitrate and long before the channel. But the WISH has to
  // outlive the bad patch — a camera closed by a bad minute and never reopened
  // is a camera the player has to notice is missing.
  async function tick(times: number) {
    for (let i = 0; i < times; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    }
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closes the camera when the link goes bad, and reopens it when it comes back', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    session().stats = { rttMs: 40, loss: 0 };
    await act(async () => { await result.current.toggleCamera(); });
    expect(result.current.cameraOn).toBe(true);
    expect(session().cameraCalls.at(-1)).toBe(true);

    // A link that cannot carry a picture.
    session().stats = { rttMs: 900, loss: 0.5 };
    await tick(2);
    expect(result.current.level).toBe('text');
    expect(session().cameraCalls.at(-1)).toBe(false);
    // Closed on the wire, still wanted by the player.
    expect(result.current.cameraOn).toBe(true);
    expect(result.current.selfFeed).toBeNull();

    // And back. The ladder climbs a rung at a time, so this takes a while.
    session().stats = { rttMs: 40, loss: 0 };
    await tick(12);
    expect(session().cameraCalls.at(-1)).toBe(true);
    expect(result.current.selfFeed).not.toBeNull();
  });

  // The mirror of the muted-player rule: the ladder may close a camera, it may
  // never open one nobody asked for.
  it('never opens a camera the player did not ask for', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    session().stats = { rttMs: 40, loss: 0 };
    await tick(4);
    expect(result.current.level).toBe('full');
    expect(session().cameraCalls.every((on) => on === false)).toBe(true);
  });

  // Tapping while the link is already too weak: the wish is recorded and
  // nothing is published, so the UI can say why instead of dropping the tap.
  it('records the wish without publishing on a link that cannot carry it', async () => {
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    session().stats = { rttMs: 900, loss: 0.5 };
    await tick(2);
    expect(result.current.level).toBe('text');

    const before = session().cameraCalls.length;
    await act(async () => { await result.current.toggleCamera(); });
    expect(result.current.cameraOn).toBe(true);
    expect(result.current.selfFeed).toBeNull();
    expect(session().cameraCalls).toHaveLength(before);
  });
});
