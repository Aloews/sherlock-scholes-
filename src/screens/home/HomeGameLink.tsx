import type { ReactNode } from 'react';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * One game on the home screen.
 *
 * THE SAME ROW FOR EVERY GAME, including the football Alias itself. It used
 * to be the odd one out — a stack of tall gradient buttons, while the matches
 * feed, the fantasy league and the guessing game were quiet rows underneath.
 * That was true when Alias was the only thing here, and it stopped being true
 * the moment there were four; a landing where one entry shouts and three
 * whisper reads as three afterthoughts, not as a menu.
 *
 * The row was already written three times inline, once per mini-game, and a
 * fourth copy is where the four of them start drifting apart. One component,
 * one treatment.
 */
interface HomeGameLinkProps {
  icon: ReactNode;
  label: string;
  onClick(): void;
}

export function HomeGameLink({ icon, label, onClick }: HomeGameLinkProps) {
  return (
    <button
      type="button"
      onClick={() => { hapticImpact('light'); onClick(); }}
      className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
    >
      <span className="text-brand-muted shrink-0 flex items-center">{icon}</span>
      <span className="flex-1 text-white text-sm">{label}</span>
      {/* Not an icon: the chevron is a text glyph so it takes the row's own
          colour and baseline, and it is decorative — the label is the name of
          the destination, so there is nothing here for a screen reader. */}
      <span aria-hidden="true" className="text-brand-muted text-lg leading-none">›</span>
    </button>
  );
}
