// ─── Switchable design systems ───────────────────────────────────
// The app ships two complete visual languages:
//   'master'  — the Sherlock Scholes master design system (gradient accent,
//               Playfair Display headings, lit background, stronger rarity
//               glows). The default.
//   'classic' — the original flat look (solid #FF6300, Inter everywhere).
//
// Every token lives in src/index.css as two CSS-variable sets, so switching
// is one attribute flip on <html data-design="…"> — no re-render, and no
// component needs to know which design is active. This module owns the ids,
// the metadata the switcher button needs, and the DOM write.

export type DesignId = 'classic' | 'master';

export const DESIGN_IDS: DesignId[] = ['master', 'classic'];

export const DEFAULT_DESIGN: DesignId = 'master';

interface DesignMeta {
  /** i18n key for the name shown on the switcher button. */
  labelKey: string;
  /** Telegram/browser chrome colour — mirrors the design's page background. */
  themeColor: string;
}

export const DESIGNS: Record<DesignId, DesignMeta> = {
  master:  { labelKey: 'design.master',  themeColor: '#0A0E1A' },
  classic: { labelKey: 'design.classic', themeColor: '#0A0E1A' },
};

export function isDesignId(value: unknown): value is DesignId {
  return typeof value === 'string' && (DESIGN_IDS as string[]).includes(value);
}

/** The other design — the switcher is a two-state toggle, not a menu. */
export function nextDesign(current: DesignId): DesignId {
  return current === 'master' ? 'classic' : 'master';
}

/** Put the design on the document. Idempotent; safe to call on every render. */
export function applyDesign(design: DesignId): void {
  const root = document.documentElement;
  if (root.dataset.design !== design) root.dataset.design = design;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = DESIGNS[design].themeColor;
}
