// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeCode, deepLink, shareLink, copyText, sanitizeCodeInput, codeFromText, CODE_LENGTH,
} from './invite';

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

// ── What the field holds while it is being typed into ──────────────────────
//
// The old field stored `value.toUpperCase()`, a different string from the one
// the IME had just produced, and a controlled input rewritten mid-composition
// can lose the character that caused the rewrite. These pin the replacement:
// the field holds only what a code can hold, so a keystroke is either kept
// verbatim or was never part of a code.

describe('sanitizeCodeInput', () => {
  it('keeps what a code is made of, and uppercases as it goes', () => {
    expect(sanitizeCodeInput('ab12cd')).toBe('AB12CD');
    expect(sanitizeCodeInput('a')).toBe('A');
  });

  it('accepts a single character — the field is usable before it is complete', () => {
    // The first keystroke must survive. It is not a valid code and must not be
    // treated as one, but it has to appear.
    expect(sanitizeCodeInput('x')).toBe('X');
    expect(normalizeCode(sanitizeCodeInput('x'))).toBeNull();
  });

  it('drops what a code cannot contain instead of holding it and failing later', () => {
    expect(sanitizeCodeInput('AB 12-CD')).toBe('AB12CD');
    expect(sanitizeCodeInput('ab.12,cd')).toBe('AB12CD');
    expect(sanitizeCodeInput('код')).toBe('');
  });

  it('never grows past a code', () => {
    expect(sanitizeCodeInput('AB12CDEF')).toHaveLength(CODE_LENGTH);
    expect(sanitizeCodeInput('AB12CDEF')).toBe('AB12CD');
  });

  it('reads the invite LINK, which is what people actually paste', () => {
    // Stripping punctuation from a URL would leave HTTPSTMESHERLOCK…; the link
    // has to be read as a link before anything blunt happens to it.
    expect(sanitizeCodeInput('https://t.me/sherlock_scholes_bot?startapp=AB12CD')).toBe('AB12CD');
    expect(sanitizeCodeInput(deepLink('XY9Z01'))).toBe('XY9Z01');
  });
});

describe('codeFromText', () => {
  it('answers only when there is something to join with', () => {
    expect(codeFromText('AB12CD')).toBe('AB12CD');
    expect(codeFromText(deepLink('XY9Z01'))).toBe('XY9Z01');
    expect(codeFromText('Заходи: https://t.me/sherlock_scholes_bot?startapp=ab12cd')).toBe('AB12CD');
    expect(codeFromText('AB12')).toBeNull();
    expect(codeFromText(null)).toBeNull();
  });
});
