import { describe, it, expect, afterEach, vi } from 'vitest';

// import.meta.env is substituted at build time, not read at call time, so
// each case needs its own fresh module load — same pattern as
// features/voice/providers/index.test.ts.
async function load(hidden: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_STREAM_HIDDEN', hidden ?? '');
  return import('./config');
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('isStreamHidden', () => {
  it('is visible by default', async () => {
    const mod = await load(undefined);
    expect(mod.isStreamHidden()).toBe(false);
  });

  it('is hidden when VITE_STREAM_HIDDEN=true', async () => {
    const mod = await load('true');
    expect(mod.isStreamHidden()).toBe(true);
  });

  it('treats any other value as visible', async () => {
    const mod = await load('yes');
    expect(mod.isStreamHidden()).toBe(false);
  });
});
