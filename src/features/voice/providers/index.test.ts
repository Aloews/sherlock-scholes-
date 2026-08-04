import { describe, it, expect, afterEach, vi } from 'vitest';

// Which service a build talks to, and what happens when that answer is wrong.
//
// The selection is read once at module scope, so every case reloads the module
// under a different env — the same pattern voiceApi.test.ts uses, and for the
// same reason: `import.meta.env` is substituted at build time, not read at
// call time.
//
// What these tests CANNOT reach is the property the file exists for: that an
// unselected adapter's SDK is dropped from `dist/` entirely. That is a build
// outcome, not a runtime one. It is verified by building and looking — see
// docs/VOICE_PROVIDERS.md §5 — and the shape of the code that produces it
// (raw literals, `if` not `switch`) is spelled out where it can be broken.

async function load(provider: string | undefined, extra: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_VOICE_PROVIDER', provider ?? '');
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
  return import('./index');
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('choosing a provider', () => {
  it('defaults to livekit, which is what production runs', async () => {
    const mod = await load(undefined);
    expect(mod.voiceProvider()).toBe('livekit');
    expect(mod.voiceProviderMisconfigured()).toBe(false);
  });

  it('takes each service it implements', async () => {
    for (const id of ['livekit', 'daily', 'agora'] as const) {
      const mod = await load(id);
      expect(mod.voiceProvider()).toBe(id);
      expect(mod.voiceProviderMisconfigured()).toBe(false);
    }
  });

  it('flags a name nobody implements rather than silently using livekit', async () => {
    // Falling back quietly would mean a typo in VITE_VOICE_PROVIDER produces a
    // build that looks configured, asks the server for the wrong service, and
    // fails at join time with nothing pointing back at the typo.
    const mod = await load('zoom');
    expect(mod.voiceProviderMisconfigured()).toBe(true);
  });

  it('does not treat an empty value as a misconfiguration', async () => {
    // An unset variable arrives as '' through the same path. That is the
    // default case, not a mistake.
    const mod = await load('');
    expect(mod.voiceProviderMisconfigured()).toBe(false);
    expect(mod.voiceProvider()).toBe('livekit');
  });
});

describe('isVoiceProviderId', () => {
  it('accepts exactly the implemented ids', async () => {
    const { isVoiceProviderId, VOICE_PROVIDER_IDS } = await load('livekit');
    for (const id of VOICE_PROVIDER_IDS) expect(isVoiceProviderId(id)).toBe(true);
    for (const junk of ['', 'LiveKit', 'zoom', null, undefined, 7, {}]) {
      expect(isVoiceProviderId(junk)).toBe(false);
    }
  });
});

describe('a build with no voice configured', () => {
  it('refuses to load an adapter instead of connecting to nothing', async () => {
    // The same condition folds away at build time, taking every SDK with it.
    // At runtime it is a guard connect() never reaches, and a clear message if
    // anything else ever does.
    const mod = await load('livekit', { VITE_LIVEKIT_URL: '', VITE_VOICE_ENABLED: '' });
    await expect(mod.loadTransport()).rejects.toThrow(/not configured/);
  });
});
