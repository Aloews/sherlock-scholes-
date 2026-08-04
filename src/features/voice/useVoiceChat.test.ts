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
  const config = { refuseMic: false, refusePlayback: false, failConnect: false, attachOnConnect: false };

  class FakeSession {
    micCalls: boolean[] = [];
    startAudioCalls = 0;
    disconnectCalls = 0;
    playable = true;
    stats: { rttMs: number; loss: number } | null = null;
    /** The sink the hook handed over — the adapter's only way to be heard. */
    sink: HTMLElement | null = null;
    /** Which service built this session. */
    provider = 'livekit';

    async setMicrophoneEnabled(on: boolean) {
      this.micCalls.push(on);
      if (on && config.refuseMic) throw new DOMException('denied', 'NotAllowedError');
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
  const hooks: { speakers?: (ids: string[]) => void; playback?: (playing: boolean) => void; dropped?: () => void } = {};

  /** Services that will not come up, by id. Failover's whole subject. */
  const unreachable = new Set<string>();
  /** Services whose connect() hangs forever rather than refusing. */
  const hangs = new Set<string>();
  const attempts: string[] = [];

  function makeTransport(id: string) {
    return {
      id,
      async connect(options: {
        sink: HTMLElement;
        onSpeakers: (ids: string[]) => void;
        onPlaybackChanged: (playing: boolean) => void;
        onDisconnected: () => void;
      }) {
        attempts.push(id);
        if (hangs.has(id)) return new Promise<never>(() => {});
        if (config.failConnect || unreachable.has(id)) throw new Error(`${id}: no link`);
        const session = new FakeSession();
        session.provider = id;
        session.sink = options.sink;
        hooks.speakers = options.onSpeakers;
        hooks.playback = options.onPlaybackChanged;
        hooks.dropped = options.onDisconnected;
        sessions.push(session);
        if (config.attachOnConnect) session.play();
        return session;
      },
    };
  }

  const transports: Record<string, ReturnType<typeof makeTransport>> = {
    livekit: makeTransport('livekit'),
    daily: makeTransport('daily'),
    agora: makeTransport('agora'),
  };

  return { config, sessions, hooks, transports, unreachable, hangs, attempts };
});

vi.mock('./providers', () => ({
  loadTransport: async (id: string) => {
    const transport = fake.transports[id];
    if (!transport) throw new Error(`no adapter for ${id}`);
    return transport;
  },
  voiceProvider: () => 'livekit',
  voiceFallback: () => null,
  voiceChain: () => ['livekit'],
  voiceProviderMisconfigured: () => false,
  isVoiceProviderId: (v: unknown) => ['livekit', 'daily', 'agora'].includes(v as string),
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
  fake.attempts.length = 0;
  fake.unreachable.clear();
  fake.hangs.clear();
  fake.config.refuseMic = false;
  fake.config.refusePlayback = false;
  fake.config.failConnect = false;
  fake.config.attachOnConnect = false;
  fetchVoiceToken.mockReset();
  fetchVoiceToken.mockResolvedValue({
    ok: true,
    credentials: { provider: 'livekit', token: 'jwt.token.here', channel: 'ss_room-1', url: 'wss://example' },
  });
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

  it('says "network", not the last token-stage reason, when the link will not come up', async () => {
    fake.config.refuseMic = false;
    fake.config.failConnect = true;
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('network');
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

describe('failover to the next service', () => {
  // Failover is for a service that cannot be REACHED, not one that is merely
  // slow: switching costs a teardown, a round trip and a fresh handshake, and
  // it does nothing for a weak last mile — both services carry the same
  // WebRTC over the same phone. Bad links are the quality ladder's job.
  //
  // The order comes from the SERVER, in credentials.chain, so a client still
  // cannot pick which set of secrets the server exercises.

  /** A grant for `id`, offering `chain` as the services the server allows. */
  const grant = (id: string, chain?: string[]) => ({
    ok: true,
    credentials: { provider: id, token: `${id}-token`, channel: 'ss_room-1', url: 'wss://example', chain },
  });

  function chainOf(primary: string, fallback: string) {
    fetchVoiceToken.mockImplementation(async (_room: string, asked?: string) =>
      grant(asked ?? primary, [primary, fallback]));
  }

  it('walks to the fallback when the first service will not come up', async () => {
    chainOf('daily', 'agora');
    fake.unreachable.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('on');
    expect(result.current.provider).toBe('agora');
    expect(fake.attempts).toEqual(['daily', 'agora']);
  });

  it('mints a fresh credential for the service it moves to', async () => {
    // A token is only valid at the service that signed it, so the second
    // attempt must ask again rather than reuse what is in hand.
    chainOf('daily', 'agora');
    fake.unreachable.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fetchVoiceToken).toHaveBeenCalledTimes(2);
    expect(fetchVoiceToken).toHaveBeenLastCalledWith('room-1', 'agora');
    expect(session().provider).toBe('agora');
  });

  it('stays on the first service when it works', async () => {
    chainOf('daily', 'agora');
    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.provider).toBe('daily');
    expect(fake.attempts).toEqual(['daily']);
    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
  });

  it('gives up with a reason when every service in the chain is down', async () => {
    chainOf('daily', 'agora');
    fake.unreachable.add('daily');
    fake.unreachable.add('agora');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('network');
    expect(fake.attempts).toEqual(['daily', 'agora']);
    expect(playing()).toHaveLength(0);
  });

  it('does not walk past a denied microphone', async () => {
    // The player's answer will be the same at every service. Walking on would
    // only prompt them again, once per provider.
    chainOf('daily', 'agora');
    fake.config.refuseMic = true;

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('denied');
    expect(fake.attempts).toEqual(['daily']);
  });

  it('stays put when the server offers no chain', async () => {
    // A deployment too old to send one. The build's own chain is a single
    // service, so there is nowhere to go and nothing extra to ask for.
    fetchVoiceToken.mockResolvedValue(grant('livekit'));
    fake.unreachable.add('livekit');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(fake.attempts).toEqual(['livekit']);
    expect(fetchVoiceToken).toHaveBeenCalledTimes(1);
  });

  it('does not try the same service twice when the chain repeats it', async () => {
    fetchVoiceToken.mockImplementation(async (_r: string, asked?: string) =>
      grant(asked ?? 'daily', ['daily', 'daily']));
    fake.unreachable.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(fake.attempts).toEqual(['daily']);
  });

  it('refuses a credential minted for a different service than it asked for', async () => {
    // Valid and useless: the adapter would wait out a handshake that cannot
    // happen. Caught before the timeout rather than by it.
    fetchVoiceToken.mockImplementation(async (_r: string, asked?: string) =>
      asked === 'agora' ? grant('daily', ['daily', 'agora']) : grant('daily', ['daily', 'agora']));
    fake.unreachable.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.reason).toBe('provider_mismatch');
  });
});

describe('a service that hangs instead of refusing', () => {
  // The normal shape of a blocked service: connect() never settles. Without a
  // clock the walk would stop at the first one forever.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('times out and moves on', async () => {
    fetchVoiceToken.mockImplementation(async (_r: string, asked?: string) => ({
      ok: true,
      credentials: {
        provider: asked ?? 'daily', token: 't', channel: 'ss_room-1',
        url: 'wss://example', chain: ['daily', 'agora'],
      },
    }));
    fake.hangs.add('daily');

    const { result, unmount } = renderHook(() => useVoiceChat('room-1'));
    release = unmount;
    const connecting = act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    await connecting;

    expect(fake.attempts).toEqual(['daily', 'agora']);
    expect(result.current.provider).toBe('agora');
  });
});
