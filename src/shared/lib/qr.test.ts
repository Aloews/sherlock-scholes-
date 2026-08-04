import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { encodeQr, versionFor, qrPath, type QrMatrix } from './qr';
import { deepLink } from '@/features/lobby/invite';

// A hand-written QR encoder is worth exactly as much as a scanner's opinion of
// it, so these tests do not check bits — they render the matrix and decode it
// with an independent implementation (jsQR). A single wrong module anywhere in
// the pipeline (Reed–Solomon, interleaving, placement, masking, format bits)
// fails here.

const QUIET = 4; // modules of margin the standard requires around a symbol
const SCALE = 4; // pixels per module — enough for the decoder to lock on

/** Renders a matrix to the RGBA bitmap jsQR expects. */
function toBitmap(m: QrMatrix): { data: Uint8ClampedArray; width: number; height: number } {
  const side = (m.size + QUIET * 2) * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.modules[r][c]) continue;
      for (let y = 0; y < SCALE; y++) {
        for (let x = 0; x < SCALE; x++) {
          const px = ((r + QUIET) * SCALE + y) * side + ((c + QUIET) * SCALE + x);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

function roundTrip(text: string): string | null {
  const bitmap = toBitmap(encodeQr(text));
  return jsQR(bitmap.data, bitmap.width, bitmap.height)?.data ?? null;
}

describe('encodeQr — decoded by jsQR', () => {
  it('round-trips the invite link this exists for', () => {
    const link = deepLink('AB12CD');
    expect(roundTrip(link)).toBe(link);
  });

  // Every version has its own alignment patterns and block layout; a mistake
  // in one of them would hide behind a single happy-path case.
  it.each([
    ['v1, one block',        'AB12CD'],
    ['v2',                   'x'.repeat(20)],
    ['v3',                   'x'.repeat(40)],
    ['v4, two blocks',       'x'.repeat(60)],
    ['v5',                   'x'.repeat(80)],
    ['v6, four blocks',      'x'.repeat(106)],
  ])('round-trips %s', (_name, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it('round-trips non-ASCII, which is bytes not characters', () => {
    const text = 'Шерлок Скоулс ⚽';
    expect(roundTrip(text)).toBe(text);
  });
});

describe('versionFor', () => {
  it('picks the smallest version that fits', () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(49)).toBe(4); // the room deep link
    expect(versionFor(106)).toBe(6);
  });

  it('refuses what this encoder cannot hold', () => {
    expect(versionFor(107)).toBeNull();
  });
});

describe('encodeQr — structure', () => {
  it('throws rather than truncate', () => {
    expect(() => encodeQr('x'.repeat(107))).toThrow(/exceeds version/);
  });

  it('sizes the symbol by version: 17 + 4v', () => {
    expect(encodeQr('AB12CD').size).toBe(21);
    expect(encodeQr('x'.repeat(60)).size).toBe(33);
  });

  it('draws the three finder patterns and leaves the fourth corner free', () => {
    const m = encodeQr(deepLink('AB12CD'));
    const eye = (r: number, c: number) => m.modules[r][c] && !m.modules[r + 1][c + 1];
    expect(eye(0, 0)).toBe(true);
    expect(eye(0, m.size - 7)).toBe(true);
    expect(eye(m.size - 7, 0)).toBe(true);
    // Bottom-right corner is data, not a finder — it must not read as one.
    expect(m.modules[m.size - 1][m.size - 1] && !m.modules[m.size - 2][m.size - 2])
      .not.toBe(eye(0, 0) && m.modules[m.size - 4][m.size - 4]);
  });

  it('keeps the timing patterns alternating', () => {
    const m = encodeQr(deepLink('AB12CD'));
    for (let i = 8; i < m.size - 8; i++) {
      expect(m.modules[6][i]).toBe(i % 2 === 0);
      expect(m.modules[i][6]).toBe(i % 2 === 0);
    }
  });
});

describe('qrPath', () => {
  it('emits one 1×1 rect per dark module, in module coordinates', () => {
    const m = encodeQr('AB12CD');
    const dark = m.modules.flat().filter(Boolean).length;
    expect(qrPath(m).match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
  });
});
