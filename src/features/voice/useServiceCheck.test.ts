// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// "Проверить звук" used to test the microphone and stop there — device only,
// no network, no vendor. It passed on phones that could not hold a call,
// because it never asked whether the voice got out. This is the half that
// asks, and the half that must not leave a microphone open behind it.

const fetchCheckToken = vi.fn();
vi.mock('./voiceApi', () => ({
  fetchCheckToken: (...args: unknown[]) => fetchCheckToken(...args),
}));

const fake = vi.hoisted(() => {
  const state = {
    available: ['livekit', 'daily', 'agora'] as string[],
    refuse: new Set<string>(),
    /** Sessions handed out, so the test can see whether they were closed. */
    sessions: [] as { provider: string; disconnects: number }[],
    stats: { rttMs: 42, loss: 0 } as { rttMs: number; loss: number } | null,
  };
  return { state };
});

vi.mock('./providers', () => ({
  availableProviders: () => fake.state.available,
  loadTransportFor: async (id: string) => ({
    id,
    async connect() {
      if (fake.state.refuse.has(id)) throw { errorMsg: `${id} said no` };
      const session = { provider: id, disconnects: 0 };
      fake.state.sessions.push(session);
      return {
        async setMicrophoneEnabled() {},
        async startAudio() {},
        canPlaybackAudio() { return true; },
        async linkStats() { return fake.state.stats; },
        async disconnect() { session.disconnects += 1; },
      };
    },
  }),
}));

const { useServiceCheck } = await import('./useServiceCheck');

beforeEach(() => {
  vi.useFakeTimers();
  fake.state.available = ['livekit', 'daily', 'agora'];
  fake.state.refuse.clear();
  fake.state.sessions.length = 0;
  fake.state.stats = { rttMs: 42, loss: 0 };
  fetchCheckToken.mockReset();
  fetchCheckToken.mockImplementation(async (provider: string) => ({
    ok: true,
    credentials: { provider, token: 'jwt', channel: `chk_1`, url: 'wss://example' },
  }));
});

/** Runs the whole sweep, letting the settle delay elapse for each service. */
async function sweep(result: { current: ReturnType<typeof useServiceCheck> }) {
  await act(async () => {
    const done = result.current.run();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
  });
}

describe('checking every service this build carries', () => {
  it('reports each one reachable with what the link measured', async () => {
    const { result } = renderHook(() => useServiceCheck());
    await sweep(result);

    expect(result.current.results.map((r) => r.provider)).toEqual(['livekit', 'daily', 'agora']);
    expect(result.current.results.every((r) => r.outcome === 'reachable')).toBe(true);
    expect(result.current.results[0].stats).toEqual({ rttMs: 42, loss: 0 });
  });

  it('carries on past a service that refuses, and quotes it', async () => {
    fake.state.refuse.add('daily');
    const { result } = renderHook(() => useServiceCheck());
    await sweep(result);

    const byId = Object.fromEntries(result.current.results.map((r) => [r.provider, r]));
    expect(byId.livekit.outcome).toBe('reachable');
    expect(byId.daily.outcome).toBe('failed');
    expect(byId.daily.detail).toMatch(/daily said no/);
    expect(byId.agora.outcome).toBe('reachable');
  });

  it('says which stage failed when the token never came', async () => {
    fetchCheckToken.mockResolvedValue({ ok: false, reason: 'no_init_data' });
    const { result } = renderHook(() => useServiceCheck());
    await sweep(result);

    expect(result.current.results.every((r) => r.outcome === 'failed')).toBe(true);
    expect(result.current.results[0].detail).toMatch(/no_init_data/);
  });

  it('only reports the services this build actually carries', async () => {
    fake.state.available = ['livekit'];
    const { result } = renderHook(() => useServiceCheck());
    await sweep(result);
    expect(result.current.results).toHaveLength(1);
  });
});

// THE PART THAT MATTERS MOST. A diagnostic that leaves a session open leaves a
// MICROPHONE open, and Daily's single call object would then refuse every real
// attempt after it — the diagnostic breaking the thing it was run to diagnose.
describe('cleaning up after itself', () => {
  it('closes every session it opened', async () => {
    const { result } = renderHook(() => useServiceCheck());
    await sweep(result);

    expect(fake.state.sessions).toHaveLength(3);
    expect(fake.state.sessions.every((s) => s.disconnects === 1)).toBe(true);
  });

  it('leaves nothing in the document', async () => {
    const { result } = renderHook(() => useServiceCheck());
    // Counted after mounting, so the testing library's own container is not
    // mistaken for something this hook left behind.
    const before = document.body.children.length;
    await sweep(result);
    expect(document.body.children.length).toBe(before);
  });

  it('refuses to start a second sweep on top of a running one', async () => {
    const { result } = renderHook(() => useServiceCheck());
    await act(async () => {
      void result.current.run();
      void result.current.run();
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Three services, not six.
    expect(fake.state.sessions).toHaveLength(3);
  });
});
