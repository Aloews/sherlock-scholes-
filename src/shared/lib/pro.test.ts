import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isProTag,
  PRO_FILTERS,
  PRO_FRAMES,
  FRAME_COLOR,
  PRO_TIERS,
  PRO_PRICE_STARS,
} from './pro';

// Pro model — client-side gating only (the is_pro flag is enforced server-side).
// These pin the tag/frame lookup tables so a future edit that drops or renames a
// pro filter/frame is caught.

describe('isProTag', () => {
  it('is true for every declared pro filter tag', () => {
    for (const f of PRO_FILTERS) expect(isProTag(f.tag)).toBe(true);
  });

  it('is false for non-pro tags and junk', () => {
    for (const t of ['', 'star', 'goalkeeper', 'unknown', 'legendx']) {
      expect(isProTag(t)).toBe(false);
    }
  });

  it('matches exactly the pro filter tag set (property)', () => {
    const proTags = new Set(PRO_FILTERS.map((f) => f.tag));
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isProTag(s)).toBe(proTags.has(s));
      }),
    );
  });
});

describe('pro filters shape', () => {
  it('every filter has a non-empty id, tag, and a home.* i18n labelKey', () => {
    expect(PRO_FILTERS.length).toBeGreaterThan(0);
    for (const f of PRO_FILTERS) {
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.tag.length).toBeGreaterThan(0);
      expect(f.labelKey.startsWith('home.')).toBe(true);
    }
  });

  it('exposes the two known pro filters (legend, ballon_dor)', () => {
    expect(PRO_FILTERS.map((f) => f.tag).sort()).toEqual(['ballon_dor', 'legend']);
  });

  it('has a positive Stars price', () => {
    expect(PRO_PRICE_STARS).toBeGreaterThan(0);
  });
});

describe('pro frames', () => {
  it('default frame has no colour; every non-default frame has one', () => {
    expect(FRAME_COLOR.default).toBeNull();
    for (const frame of PRO_FRAMES.filter((f) => f !== 'default')) {
      expect(FRAME_COLOR[frame]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('FRAME_COLOR covers exactly the declared frames', () => {
    expect(Object.keys(FRAME_COLOR).sort()).toEqual([...PRO_FRAMES].sort());
  });
});

describe('pro tiers', () => {
  it('reserves the legendary tier for pro', () => {
    expect(PRO_TIERS).toContain('legendary');
  });
});
