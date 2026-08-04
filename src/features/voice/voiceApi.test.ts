import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Voice says "Недоступен" on production and the Edge Function log shows
// `OPTIONS 200` with NO `POST` after it (docs/LOBBY_AND_VOICE_FIXES.md §3).
// A request that never leaves the browser cannot appear in a server log, so
// these tests pin the paths where fetchVoiceToken answers WITHOUT asking the
// server — and, since the reason now travels with the answer, that every
// refusal is reported as itself rather than as one shared silence.
//
// What cannot be tested here: whether real Telegram supplies initData on a
// cold start. That needs a device — initData cannot be forged from outside
// Telegram by design. These tests fix the client half so the remaining
// unknown is exactly one thing, and so the device says which one it is.

const invoke = vi.fn();
const getRawInitData = vi.fn();

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: () => getRawInitData(),
}));

const LIVEKIT_URL = 'wss://sherlok-1k9zd0ef.livekit.cloud';
const INIT_DATA = 'query_id=AAA&user=%7B%22id%22%3A1%7D&hash=deadbeef';

/** VITE_LIVEKIT_URL is captured at module scope, so the env must be set first. */
async function loadApi(url: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_LIVEKIT_URL', url ?? '');
  return import('./voiceApi');
}

/** supabase-js hands a non-2xx back as an error carrying the raw Response. */
function httpError(body: unknown) {
  return { message: 'Edge Function returned a non-2xx status code', context: { json: async () => body } };
}

beforeEach(() => {
  invoke.mockReset();
  getRawInitData.mockReset();
  getRawInitData.mockReturnValue(INIT_DATA);
  invoke.mockResolvedValue({ data: { token: 'jwt.token.here', channel: 'room-1:team-a' }, error: null });
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('voiceEnabled', () => {
  it('is off when the address is not configured', async () => {
    const api = await loadApi(undefined);
    expect(api.voiceEnabled()).toBe(false);
    expect(api.livekitUrl()).toBe('');
  });

  it('is on when it is', async () => {
    const api = await loadApi(LIVEKIT_URL);
    expect(api.voiceEnabled()).toBe(true);
    expect(api.livekitUrl()).toBe(LIVEKIT_URL);
  });
});

describe('fetchVoiceToken — the request that is never sent', () => {
  // THE regression test for §3. An empty initData short-circuits before
  // invoke(), so the network sees the preflight of nothing at all — which is
  // exactly the production symptom: OPTIONS 200, no POST.
  it('does not call the server when initData is empty, and says why', async () => {
    getRawInitData.mockReturnValue('');
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'no_init_data' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not call the server when initData is missing entirely', async () => {
    getRawInitData.mockReturnValue(undefined);
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'no_init_data' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not call the server when voice is not configured', async () => {
    const api = await loadApi(undefined);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('fetchVoiceToken — the request that is sent and refused', () => {
  // These DO reach the function, so they leave a POST in the log. Each one is
  // reported as itself: "pick a team" and "we never asked" are opposite bugs.
  const cases = [
    ['no_team_yet', 'no_team_yet'],
    ['unauthorized', 'unauthorized'],
    ['not_in_room', 'not_in_room'],
    ['no_such_room', 'no_such_room'],
    ['room_finished', 'room_finished'],
    ['bad_request', 'bad_request'],
    ['voice_not_configured', 'voice_not_configured'],
  ] as const;

  it.each(cases)('reports %s as itself', async (code, reason) => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: code }) });
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('falls back to network when the error carries no readable body', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('does not echo an unknown code back as a reason', async () => {
    // A code the client does not know is not a diagnosis — reporting it as one
    // would put unvalidated server text on the player's screen.
    invoke.mockResolvedValue({ data: null, error: httpError({ error: 'teapot' }) });
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('reports a 200 that carries no token as malformed', async () => {
    invoke.mockResolvedValue({ data: { channel: 'room-1:team-a' }, error: null });
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('fetchVoiceToken — the happy path and its contract', () => {
  it('returns the token and the channel the server picked', async () => {
    const api = await loadApi(LIVEKIT_URL);

    await expect(api.fetchVoiceToken('room-1')).resolves.toEqual({
      ok: true,
      token: 'jwt.token.here',
      channel: 'room-1:team-a',
    });
  });

  it('sends initData and the room, and names neither the channel nor the player', async () => {
    // The security contract from voiceApi's own docstring: the server derives
    // the identity from the validated initData and the channel from the
    // player's team. A client that could name its own channel could join the
    // opposing team's and hear the explainer.
    const api = await loadApi(LIVEKIT_URL);
    await api.fetchVoiceToken('room-42');

    expect(invoke).toHaveBeenCalledWith('livekit-token', {
      body: { initData: INIT_DATA, roomId: 'room-42' },
    });

    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body).sort()).toEqual(['initData', 'roomId']);
    expect(options.body).not.toHaveProperty('channel');
    expect(options.body).not.toHaveProperty('playerId');
  });
});
