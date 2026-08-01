import { IconLock } from '@tabler/icons-react';

/**
 * One chip = one toggle, for dense sets where a full row each would be a
 * wall (categories, continents, player traits).
 *
 * Selected is a TINT, not a solid fill: a group where a dozen chips are on
 * by default would otherwise read as a block of orange, and the accent
 * belongs to the primary action alone.
 */
export interface ChipProps {
  label: string;
  selected: boolean;
  /** Shows the gold Pro padlock before the label. */
  locked?: boolean;
  onClick: () => void;
}

export function Chip({ label, selected, locked, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 h-11 px-3.5 rounded-full text-xs font-medium border transition-colors ${
        selected
          ? 'border-brand-accent bg-brand-accent/15 text-white'
          : 'border-brand-border bg-brand-surface text-brand-muted active:text-white'
      }`}
    >
      {/* Pro gold is fixed across designs — it marks the paid tier, not a state. */}
      {locked && <IconLock size={11} stroke={2.5} className="text-[#FFD24A]" />}
      {label}
    </button>
  );
}
