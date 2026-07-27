// Rarity-tier visuals — subtle coloured frame/glow, shared by the in-game card
// and the history avatars. 'common' (and unknown) get NO treatment, so the deck
// doesn't look noisy; rarer tiers glow a touch more.
//
// The tier COLOURS are fixed (TIER_COLOR); only the weight of the treatment is
// a design-system decision — the master design frames cards harder and glows
// wider than classic. Callers that want the frame to change the instant the
// player flips designs pass the value from useDesign(); omitting it reads the
// current setting once, at call time.

import type { CSSProperties } from 'react';
import { TIER_COLOR, TIERS, type Tier } from '@/shared/types/database';
import { getDesign } from '@/shared/design/useDesign';
import type { DesignId } from '@/shared/design/designs';

function asTier(t?: string | null): Tier | null {
  return t && (TIERS as string[]).includes(t) ? (t as Tier) : null;
}

/** Border + soft outward glow for a big card (in-game). Common/unknown → none. */
export function tierCardStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = TIER_COLOR[t];
  const master = design === 'master';
  // 'icon' is the top tier: the thickest frame and the widest, whitest glow.
  const ring = t === 'icon' ? '2px' : master ? '1.5px' : '1px';
  // px radius, then alpha — master roughly doubles the spread and lifts the
  // opacity so a legendary reads as lit rather than outlined.
  const [blur, alpha] =
    t === 'icon'      ? (master ? [40, '59'] : [24, '59'])
    : t === 'legendary' ? (master ? [34, '80'] : [18, '66'])
    : t === 'epic'    ? (master ? [26, '70'] : [14, '55'])
    :                   (master ? [22, '55'] : [10, '40']);
  return {
    borderColor: c,
    boxShadow: `inset 0 0 0 ${ring} ${c}, 0 0 ${blur}px ${c}${alpha}`,
  };
}

/** Gradient rarity frame for the master design: a thin padded wrapper whose
 * background is the gradient, with the card drawn inside it. Classic keeps the
 * inset ring from tierCardStyle instead, so this returns undefined there —
 * callers render the plain card when it does. */
export function tierFrameStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  if (design !== 'master') return undefined;
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = TIER_COLOR[t];
  const pad = t === 'icon' ? '2px' : '1.5px';
  const blur = t === 'icon' ? 40 : t === 'legendary' ? 34 : t === 'epic' ? 26 : 22;
  return {
    padding: pad,
    background: `linear-gradient(155deg, ${c}bf, ${c}1f 45%, ${c}8c)`,
    boxShadow: `0 0 ${blur}px ${c}47`,
  };
}

/** Subtle ring around a small history avatar. Common/unknown → none. */
export function tierRingStyle(tier?: string | null, design: DesignId = getDesign()): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = TIER_COLOR[t];
  if (t === 'icon') return { boxShadow: `0 0 0 2px ${c}, 0 0 ${design === 'master' ? 16 : 10}px ${c}99` };
  return design === 'master'
    ? { boxShadow: `0 0 0 2px ${c}, 0 0 12px ${c}88` }
    : { boxShadow: `0 0 0 2px ${c}, 0 0 6px ${c}66` };
}
