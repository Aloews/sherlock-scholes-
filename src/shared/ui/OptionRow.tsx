import type { ReactNode } from 'react';
import { IconCheck, IconChevronRight, IconLock } from '@tabler/icons-react';

/**
 * One row = one choice.
 *
 * A row that TOGGLES something ends in a check circle — that circle is the
 * app's single "this is on" signal, and nothing else should invent another.
 * A row that ACTS (starts a game, opens a screen) ends in a chevron
 * instead, so a list of actions doesn't read as a list of unticked
 * checkboxes.
 */
export interface OptionRowProps {
  title: ReactNode;
  description?: string;
  /** Emoji or icon in the leading tile. */
  leading?: ReactNode;
  /** Trailing count; negative or null hides it. */
  count?: number | null;
  selected?: boolean;
  /** Shows the gold Pro padlock next to the title. */
  locked?: boolean;
  disabled?: boolean;
  /** Ends the row with a chevron instead of a check circle. */
  action?: boolean;
  onClick: () => void;
}

export function OptionRow({
  title, description, leading, count, selected, locked, disabled, action, onClick,
}: OptionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-3.5 flex items-center gap-3 transition-colors ${
        selected ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-brand-surface'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:bg-brand-border/40'}`}
    >
      {leading && (
        <span className="w-10 h-10 rounded-xl bg-brand-border/60 flex items-center justify-center text-xl flex-shrink-0">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-white font-semibold truncate">{title}</span>
          {/* Pro gold is fixed across designs — it marks the paid tier, not a state. */}
          {locked && <IconLock size={13} stroke={2.5} className="text-[#FFD24A]" />}
        </span>
        {description && (
          <span className="block text-brand-muted text-xs mt-0.5 leading-snug">{description}</span>
        )}
      </span>
      {count != null && count >= 0 && (
        <span className="text-brand-muted/70 text-xs tabular-nums flex-shrink-0">{count}</span>
      )}
      {action ? (
        <IconChevronRight size={18} stroke={2} className="text-brand-muted flex-shrink-0" />
      ) : (
        <span
          className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
            selected ? 'border-transparent bg-brand-accent' : 'border-brand-border'
          }`}
        >
          {selected && <IconCheck size={13} stroke={3} className="text-brand-bg" />}
        </span>
      )}
    </button>
  );
}
