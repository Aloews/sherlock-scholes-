// Typed colour maps — the palette applied to the product's own concepts.
//
// Everything that used to be a per-screen `const CATEGORY_COLOR = {…}`
// lives here once. The category map in particular existed twice, byte for
// byte, in TrainingScreen and PlayerCard: a card could be rendered in two
// different colours by two screens the moment one of the copies changed.

import type { CardCategory, Tier } from '@/shared/types/database';
import {
  ACCENT, BLUE, CYAN, GOLD, GREEN, MUTED, PINK, PURPLE, ROSE,
} from './palette';

/** Card category → its accent. Categories that read as the same kind of
 *  thing deliberately share a colour (a club and its nickname, a term and
 *  a position). */
export const CATEGORY_COLOR: Record<CardCategory, string> = {
  player:        ACCENT,
  club:          BLUE,
  club_nickname: BLUE,
  stadium:       GREEN,
  term:          PURPLE,
  position:      PURPLE,
  referee:       GOLD,
  coach:         GOLD,
  commentator:   MUTED,
  woman:         PINK,
  derby:         ROSE,
  trophy:        GOLD,
  era:           CYAN,
};

/** Rarity frames. Cosmetic only — the tier itself is derived from
 *  cards.fame (see supabase/migrations/deck_fame.sql). */
export const TIER_COLOR: Record<Tier, string> = {
  legendary: GOLD,
  epic:      PURPLE,
  rare:      BLUE,
  common:    MUTED,
};

/** The two teams of a local game. */
export type TeamColorKey = 'orange' | 'blue';
export const TEAM_COLOR: Record<TeamColorKey, string> = {
  orange: ACCENT,
  blue:   BLUE,
};

/** Pro avatar frames. 'default' has none. */
export type ProFrame = 'default' | 'gold' | 'purple';
export const FRAME_COLOR: Record<ProFrame, string | null> = {
  default: null,
  gold:    GOLD,
  purple:  PURPLE,
};

/** Identity colours for avatars without a photo, picked by name hash.
 *  Used to be eight Tailwind defaults that belonged to no palette at all. */
export const AVATAR_COLORS = [GREEN, BLUE, GOLD, ROSE, PURPLE, CYAN, ACCENT, PINK];
