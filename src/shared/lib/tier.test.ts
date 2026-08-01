import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tierCardStyle, tierFrameStyle, tierRingStyle } from './tier';
import { TIERS, TIER_COLOR } from '@/shared/types/database';

// Largest `0 0 Npx` radius in a boxShadow — the outward glow, as opposed to the
// inset border that shares the same property.
const glowRadius = (shadow: unknown): number =>
  Math.max(...[...String(shadow).matchAll(/0 0 (\d+)px/g)].map((m) => Number(m[1])));

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

// Every helper takes an explicit DesignId so the visuals restyle the moment the
// player flips designs. The tests above call them without one, which reads the
// current setting and only ever exercises a single branch — so the master/classic
// split below is asserted explicitly, or half of each function goes unverified.

describe('tierCardStyle — design branches', () => {
  it('frames and glows harder in master than in classic', () => {
    for (const t of ['icon', 'legendary', 'epic', 'rare'] as const) {
      const master  = tierCardStyle(t, 'master')!;
      const classic = tierCardStyle(t, 'classic')!;
      expect(glowRadius(master.boxShadow)).toBeGreaterThan(glowRadius(classic.boxShadow));
    }
  });

  it('gives icon the thickest inset ring in both designs', () => {
    // The inset segment carries the ring width: `inset 0 0 0 <ring> <colour>`.
    const ring = (t: string, d: 'master' | 'classic') =>
      String(tierCardStyle(t, d)!.boxShadow).match(/inset 0 0 0 ([\d.]+)px/)![1];
    expect(Number(ring('icon', 'master'))).toBeGreaterThan(Number(ring('legendary', 'master')));
    expect(Number(ring('icon', 'classic'))).toBeGreaterThan(Number(ring('legendary', 'classic')));
  });

  it('still returns nothing for common in either design', () => {
    expect(tierCardStyle('common', 'master')).toBeUndefined();
    expect(tierCardStyle('common', 'classic')).toBeUndefined();
  });
});

describe('tierFrameStyle', () => {
  it('is a master-only treatment — classic keeps the inset ring instead', () => {
    for (const t of TIERS) {
      expect(tierFrameStyle(t, 'classic')).toBeUndefined();
    }
  });

  it('returns undefined for common, unknown and nullish even in master', () => {
    expect(tierFrameStyle('common', 'master')).toBeUndefined();
    expect(tierFrameStyle(undefined, 'master')).toBeUndefined();
    expect(tierFrameStyle(null, 'master')).toBeUndefined();
    expect(tierFrameStyle('not-a-tier', 'master')).toBeUndefined();
  });

  it('paints a gradient in the tier colour with padding and a glow', () => {
    for (const t of ['icon', 'legendary', 'epic', 'rare'] as const) {
      const style = tierFrameStyle(t, 'master')!;
      expect(style).toBeDefined();
      expect(String(style.background)).toContain('linear-gradient');
      expect(String(style.background)).toContain(TIER_COLOR[t]);
      expect(String(style.padding)).toMatch(/px$/);
      expect(String(style.boxShadow)).toContain(TIER_COLOR[t]);
    }
  });

  it('pads icon wider than the tiers below it', () => {
    const pad = (t: string) => parseFloat(String(tierFrameStyle(t, 'master')!.padding));
    expect(pad('icon')).toBeGreaterThan(pad('legendary'));
    expect(pad('legendary')).toBe(pad('rare'));
  });

  it('scales the glow by rarity (icon > legendary > epic > rare)', () => {
    const r = (t: string) => glowRadius(tierFrameStyle(t, 'master')!.boxShadow);
    expect(r('icon')).toBeGreaterThan(r('legendary'));
    expect(r('legendary')).toBeGreaterThan(r('epic'));
    expect(r('epic')).toBeGreaterThan(r('rare'));
  });
});

describe('tierRingStyle — design branches', () => {
  it('glows wider in master than in classic', () => {
    for (const t of ['icon', 'legendary', 'epic', 'rare'] as const) {
      const master  = glowRadius(tierRingStyle(t, 'master')!.boxShadow);
      const classic = glowRadius(tierRingStyle(t, 'classic')!.boxShadow);
      expect(master).toBeGreaterThan(classic);
    }
  });

  it('gives icon a wider glow than the tiers below it', () => {
    for (const d of ['master', 'classic'] as const) {
      const icon = glowRadius(tierRingStyle('icon', d)!.boxShadow);
      const leg  = glowRadius(tierRingStyle('legendary', d)!.boxShadow);
      expect(icon).toBeGreaterThan(leg);
    }
  });

  it('rings every decorated tier at 2px in both designs', () => {
    for (const t of ['icon', 'legendary', 'epic', 'rare'] as const) {
      for (const d of ['master', 'classic'] as const) {
        expect(String(tierRingStyle(t, d)!.boxShadow)).toContain(`0 0 0 2px ${TIER_COLOR[t]}`);
      }
    }
  });
});

describe('tier helpers — properties (fast-check)', () => {
  it('never throws and only decorates real non-common tiers', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...(['master', 'classic'] as const)), (s, design) => {
        const card  = tierCardStyle(s, design);
        const ring  = tierRingStyle(s, design);
        const frame = tierFrameStyle(s, design);
        const isDecoratedTier = (TIERS as string[]).includes(s) && s !== 'common';
        expect(card !== undefined).toBe(isDecoratedTier);
        expect(ring !== undefined).toBe(isDecoratedTier);
        // The gradient frame is the master design's treatment only.
        expect(frame !== undefined).toBe(isDecoratedTier && design === 'master');
      }),
    );
  });
});
