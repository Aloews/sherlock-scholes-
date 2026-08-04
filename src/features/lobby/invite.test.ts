// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCode, deepLink, shareLink, copyText } from './invite';

// The invite path is the only way into a room other than reading six
// characters out loud, and every one of its inputs comes from outside: a
// Telegram start_param, a paste, a clipboard API that may refuse.

describe('normalizeCode', () => {
  it('accepts a six-character code and uppercases it', () => {
    expect(normalizeCode('ab12cd')).toBe('AB12CD');
    expect(normalizeCode('  XY9Z01 ')).toBe('XY9Z01');
  });

  it('rejects anything that is not a room code', () => {
    for (const bad of ['', '  ', 'ABC', 'ABCDEFG', 'ABC-12', 'ЖЖЖЖЖЖ', null, undefined]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });

  it('rejects a payload that would smuggle a URL through start_param', () => {
    expect(normalizeCode('https://evil.example/x')).toBeNull();
  });
});

describe('deepLink / shareLink', () => {
  it('puts the code in startapp, where Telegram reads it back as start_param', () => {
    expect(deepLink('AB12CD')).toBe('https://t.me/sherlock_scholes_bot?startapp=AB12CD');
  });

  it('wraps the deep link in the share sheet, encoded once as a parameter', () => {
    const url = new URL(shareLink('AB12CD', 'Play with me — AB12CD'));
    expect(url.origin + url.pathname).toBe('https://t.me/share/url');
    expect(url.searchParams.get('url')).toBe('https://t.me/sherlock_scholes_bot?startapp=AB12CD');
    expect(url.searchParams.get('text')).toBe('Play with me — AB12CD');
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'execCommand');
  });

  const stubClipboard = (writeText: () => Promise<void>) =>
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

  it('reports success when the Clipboard API takes it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    expect(await copyText('AB12CD')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('AB12CD');
  });

  // The Telegram WebView case that started all this: the promise rejects, and
  // the old code neither awaited nor caught it, so the failure vanished.
  it('falls back to execCommand when the Clipboard API rejects', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowed')));
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });

    expect(await copyText('AB12CD')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('falls back when the Clipboard API is absent entirely', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true), configurable: true,
    });
    expect(await copyText('AB12CD')).toBe(true);
  });

  it('reports failure — not success — when both paths fail', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowed')));
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false), configurable: true,
    });
    expect(await copyText('AB12CD')).toBe(false);
  });

  it('leaves no textarea behind, even when execCommand throws', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowed')));
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => { throw new Error('boom'); }), configurable: true,
    });
    expect(await copyText('AB12CD')).toBe(false);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
