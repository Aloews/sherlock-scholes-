import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tierCardStyle, tierRingStyle } from './tier';
import { TIERS, TIER_COLOR } from '@/shared/types/database';

// The rarity-tier helpers are pure: same input -> same style, and only rare+
// tiers get a visual treatment ('common' and unknown are intentionally bare so
// the deck doesn't look noisy).

describe('tierCardStyle', () => {
  it('returns undefined for common, unknown and nullish tiers', () => {
    expect(tierCardStyle('common')).toBeUndefined();
    expect(tierCardStyle(undefined)).toBeUndefined();
    expect(tierCardStyle(null)).toBeUndefined();
    expect(tierCardStyle('not-a-tier')).toBeUndefined();
  });

  it('uses the tier colour for the border of rare/epic/legendary', () => {
    for (const t of ['legendary', 'epic', 'rare'] as const) {
      const style = tierCardStyle(t);
      expect(style).toBeDefined();
      expect(style!.borderColor).toBe(TIER_COLOR[t]);
      expect(String(style!.boxShadow)).toContain(TIER_COLOR[t]);
    }
  });

  it('scales the glow radius by rarity (legendary > epic > rare)', () => {
    const radius = (t: 'legendary' | 'epic' | 'rare') => {
      const shadow = String(tierCardStyle(t)!.boxShadow);
      // boxShadow holds an inset border (…1px) plus the outward glow (0 0 Npx);
      // the glow is the larger radius, so take the max across both segments.
      const nums = [...shadow.matchAll(/0 0 (\d+)px/g)].map((m) => Number(m[1]));
      return Math.max(...nums);
    };
    expect(radius('legendary')).toBeGreaterThan(radius('epic'));
    expect(radius('epic')).toBeGreaterThan(radius('rare'));
  });
});

describe('tierRingStyle', () => {
  it('returns undefined for common/unknown/nullish', () => {
    expect(tierRingStyle('common')).toBeUndefined();
    expect(tierRingStyle(null)).toBeUndefined();
    expect(tierRingStyle('nope')).toBeUndefined();
  });

  it('rings rare+ tiers with their colour', () => {
    for (const t of ['legendary', 'epic', 'rare'] as const) {
      expect(String(tierRingStyle(t)!.boxShadow)).toContain(TIER_COLOR[t]);
    }
  });
});

describe('tier helpers — properties (fast-check)', () => {
  it('never throws and only decorates real non-common tiers', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const card = tierCardStyle(s);
        const ring = tierRingStyle(s);
        const isDecoratedTier = (TIERS as string[]).includes(s) && s !== 'common';
        expect(card !== undefined).toBe(isDecoratedTier);
        expect(ring !== undefined).toBe(isDecoratedTier);
      }),
    );
  });
});
