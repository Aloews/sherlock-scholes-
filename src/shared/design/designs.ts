// ─── Switchable design systems ───────────────────────────────────
// The app ships three complete visual languages:
//   'master'  — the Sherlock Scholes master design system (gradient accent,
//               Playfair Display headings, lit background, stronger rarity
//               glows). The default.
//   'classic' — the original flat look (solid #FF6300, Inter everywhere).
//   'paper'   — «Футбол в деталях»: the light, warm-card collectible look
//               (cream card stock, ink text, orange accent, Playfair
//               headings). The only LIGHT design, so it is the one that
//               flips --brand-fg away from white.
//
// Every token lives in src/index.css as CSS-variable sets, so switching
// is one attribute flip on <html data-design="…"> — no re-render, and no
// component needs to know which design is active. This module owns the ids,
// the metadata the switcher button needs, and the DOM write.

export type DesignId = 'classic' | 'master' | 'paper';

export const DESIGN_IDS: DesignId[] = ['master', 'classic', 'paper'];

export const DEFAULT_DESIGN: DesignId = 'master';

interface DesignMeta {
  /** i18n key for the name shown on the switcher button. */
  labelKey: string;
  /** Telegram/browser chrome colour — mirrors the design's page background. */
  themeColor: string;
  /** Telegram colour scheme the design reads as. Drives nothing today, but
   *  it is what a light design has to declare so the switcher can stop
   *  assuming every design is dark. */
  scheme: 'dark' | 'light';
}

export const DESIGNS: Record<DesignId, DesignMeta> = {
  master:  { labelKey: 'design.master',  themeColor: '#0A0E1A', scheme: 'dark'  },
  classic: { labelKey: 'design.classic', themeColor: '#0A0E1A', scheme: 'dark'  },
  paper:   { labelKey: 'design.paper',   themeColor: '#F2EADB', scheme: 'light' },
};

export function isDesignId(value: unknown): value is DesignId {
  return typeof value === 'string' && (DESIGN_IDS as string[]).includes(value);
}

/** The next design in DESIGN_IDS order — the switcher cycles master →
 *  classic → paper → master. It was a two-state toggle before 'paper'. */
export function nextDesign(current: DesignId): DesignId {
  const i = DESIGN_IDS.indexOf(current);
  return DESIGN_IDS[(i + 1) % DESIGN_IDS.length];
}

/** Put the design on the document. Idempotent; safe to call on every render. */
export function applyDesign(design: DesignId): void {
  const root = document.documentElement;
  if (root.dataset.design !== design) root.dataset.design = design;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = DESIGNS[design].themeColor;
}
