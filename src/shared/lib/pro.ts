// Pro premium model — single source of truth for what Pro unlocks.
//
// Scaffold only: gating + blocking. Real Telegram Stars payment is a later
// step. The is_pro flag itself is decided SERVER-SIDE (get_user_status RPC,
// supabase/migrations/pro_users.sql) — nothing here trusts the client.

import type { Tier } from '@/shared/types/database';

// One-time price, placeholder. Tune later, then wire the real Stars invoice.
export const PRO_PRICE_STARS = 199;

// Pro-only deck filters. Each is a cards.tags value that reaches the deck
// through DeckFilter.tags; the server strips them for non-Pro callers in
// deck_sanitize_filter (supabase/migrations/deck_rpc.sql), so the UI lock is
// a courtesy, not the guard. 'legend' is maintained by refresh_card_fame()
// as the top of the fame axis.
export interface ProFilter {
  id: string;
  tag: string;
  labelKey: string; // i18n key
}
export const PRO_FILTERS: ProFilter[] = [
  { id: 'legend',     tag: 'legend',     labelKey: 'home.pro_filter_legends' },
  { id: 'ballon_dor', tag: 'ballon_dor', labelKey: 'home.tag_ballon_dor' },
];

// Tiers reserved for Pro (conceptual — legends). Kept so a future Pro-aware
// deck RPC can enforce it server-side too.
export const PRO_TIERS: Tier[] = ['legendary'];

// Kept in sync with pro_only_tags() in the database.

const PRO_TAG_SET = new Set(PRO_FILTERS.map((f) => f.tag));
export const isProTag = (tag: string): boolean => PRO_TAG_SET.has(tag);

// Cosmetic avatar frames — a Pro perk. 'default' is everyone's; the rest need
// Pro. settingsStore persists the choice; HomeScreen renders the ring.
export type ProFrame = 'default' | 'gold' | 'purple';
export const PRO_FRAMES: ProFrame[] = ['default', 'gold', 'purple'];
export const FRAME_COLOR: Record<ProFrame, string | null> = {
  default: null,
  gold:    '#FFD24A',
  purple:  '#B47AFF',
};
