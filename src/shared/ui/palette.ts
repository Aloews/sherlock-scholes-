// The palette — every colour value in the product, once.
//
// This file has NO imports on purpose: tailwind.config.ts reads it, so the
// CSS classes (`bg-brand-surface`, `text-brand-muted`, …) and the inline
// styles that need a raw string (SVG strokes, per-card accents, Telegram
// chrome) are generated from the same numbers. Before this, the values
// lived in tailwind.config AND as ~40 hex literals across the screens, and
// they had already drifted: two different greens for "success"
// (#00C97D and #22c55e) and two blues for a team (#4A9EFF and #3b82f6).
//
// Adding a colour here is a deliberate act. If a screen needs a shade that
// isn't in this file, that is the signal to reuse one that is — not to
// paste a hex into a component.

// ── Surfaces and text ────────────────────────────────────────────────
export const BG      = '#0A0E1A'; // page
export const SURFACE = '#13182A'; // cards, rows, inputs
export const BORDER  = '#1F2740'; // hairlines, unselected outlines
export const MUTED   = '#7A8499'; // secondary text
export const SLATE   = '#4A5270'; // dividers on dark surfaces

// ── Hues ─────────────────────────────────────────────────────────────
// ACCENT is the brand orange and carries the primary action. The rest are
// used to tell things apart (categories, tiers, teams, avatars), never to
// decorate.
export const ACCENT = '#FF6300';
export const BLUE   = '#4A9EFF';
export const PURPLE = '#B47AFF';
export const GOLD   = '#FFD24A';
export const GREEN  = '#00C97D';
export const PINK   = '#FF6BA8';
export const ROSE   = '#F43F5E';
export const CYAN   = '#22D3EE';

// ── Semantic roles ───────────────────────────────────────────────────
// What a colour MEANS, so a screen asks for the meaning and not the hue.
export const SUCCESS = GREEN;
export const WARNING = GOLD;
export const DANGER  = ROSE;
export const INFO    = BLUE;

// Pro is gold everywhere: the crown, the lock on a pro-only option, the
// price. Kept as its own name because it is a brand decision, not a state.
export const PRO = GOLD;
