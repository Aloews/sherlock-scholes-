import { IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * A native <select> wearing OptionRow's clothes — same height, radius and
 * border, and the same accent tint once a value is chosen. A long list
 * (every country in the deck) still needs the platform picker, but it
 * shouldn't look like a leftover from a form.
 */
export interface SelectRowProps {
  /** Shown as the empty option — "All countries", "All leagues". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export function SelectRow({ label, value, onChange, options }: SelectRowProps) {
  const active = value !== '';
  return (
    <div
      className={`relative rounded-2xl border ${
        active ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-brand-surface'
      }`}
    >
      <select
        value={value}
        onChange={(e) => { hapticImpact('light'); onChange(e.target.value); }}
        className="w-full h-[52px] bg-transparent pl-3.5 pr-10 text-sm text-white appearance-none focus:outline-none"
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <IconChevronDown
        size={16} stroke={2}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
      />
    </div>
  );
}
