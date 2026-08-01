import type { ReactNode } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';

/**
 * The frame a full-screen flow sits in.
 *
 * Three parts, and only the middle one scrolls: the title and the primary
 * action are always where the player left them. The deck picker used to
 * live inside HomeScreen's hero, so its options scrolled under the fold
 * and the Play button sat below them, off screen on a phone — this frame
 * exists so no screen repeats that.
 *
 *   <ScreenFrame>
 *     <ScreenHeader … />   never scrolls
 *     <ScreenBody>…</ScreenBody>
 *     <StickyFooter>…</StickyFooter>   never scrolls
 *   </ScreenFrame>
 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  // The height is the viewport MINUS the master design's bottom tab bar, via
  // its own --tabbar-h (0 outside a .with-tabbar page). A flat h-screen would
  // put the footer — and its primary button — underneath the fixed tab bar,
  // where taps land on the tab instead. `bg-brand-bg ds-screen` is the pairing
  // every screen root uses so the design's lit backdrop shows.
  return (
    <div className="min-h-screen h-[calc(100vh-var(--tabbar-h,0px))] bg-brand-bg ds-screen flex flex-col">
      {children}
    </div>
  );
}

export function ScreenHeader({
  title, onBack, backLabel, action, children,
}: {
  title: string;
  onBack: () => void;
  /** Accessible name for the back button. */
  backLabel: string;
  /** Optional trailing control — a "Reset" text button, for instance. */
  action?: ReactNode;
  /** Optional row under the title, e.g. a StepBar. */
  children?: ReactNode;
}) {
  return (
    <header className="flex-shrink-0 px-4 pt-8 pb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label={backLabel}
          className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-brand-muted active:text-white"
        >
          <IconArrowLeft size={20} stroke={2} />
        </button>
        <h1 className="text-white font-bold flex-1 truncate">{title}</h1>
        {action}
      </div>
      {children}
    </header>
  );
}

/** The only scrolling region of a screen. */
export function ScreenBody({ children }: { children: ReactNode }) {
  return <main className="flex-1 overflow-y-auto px-4 pt-2 pb-4 space-y-6">{children}</main>;
}

/** Pinned to the bottom: the state of the choice and the one action on it. */
export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex-shrink-0 px-4 pt-3 pb-6 border-t border-brand-border bg-brand-surface/40 backdrop-blur space-y-3">
      {children}
    </footer>
  );
}

/** Progress through a multi-step flow: one segment per step, filled up to
 *  and including the current one. */
export function StepBar({
  total, current, label,
}: { total: number; current: number; label: string }) {
  return (
    <div className="flex gap-1.5 mt-3" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i <= current ? 'bg-brand-accent' : 'bg-brand-border'
          }`}
        />
      ))}
    </div>
  );
}
