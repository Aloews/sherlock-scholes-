// Rarity-tier visuals — subtle coloured frame/glow, shared by the in-game card
// and the history avatars. 'common' (and unknown) get NO treatment, so the deck
// doesn't look noisy; rarer tiers glow a touch more.

import type { CSSProperties } from 'react';
import { TIER_COLOR, TIERS, type Tier } from '@/shared/types/database';

function asTier(t?: string | null): Tier | null {
  return t && (TIERS as string[]).includes(t) ? (t as Tier) : null;
}

/** Border + soft outward glow for a big card (in-game). Common/unknown → none. */
export function tierCardStyle(tier?: string | null): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = TIER_COLOR[t];
  const glow = t === 'legendary' ? `0 0 18px ${c}66`
    : t === 'epic' ? `0 0 14px ${c}55`
    : `0 0 10px ${c}40`;
  return { borderColor: c, boxShadow: `inset 0 0 0 1px ${c}, ${glow}` };
}

/** Subtle ring around a small history avatar. Common/unknown → none. */
export function tierRingStyle(tier?: string | null): CSSProperties | undefined {
  const t = asTier(tier);
  if (!t || t === 'common') return undefined;
  const c = TIER_COLOR[t];
  return { boxShadow: `0 0 0 2px ${c}, 0 0 6px ${c}66` };
}
