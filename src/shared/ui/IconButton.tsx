import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { hapticImpact } from '@/shared/lib/telegram';

// The square icon chip used in screen headers (tutorial, sound, design,
// profile, Pro). One definition, because five hand-written copies of the same
// nine Tailwind classes had already drifted: the Pro button carried `border`
// with no colour, so it drew the browser's default outline — a bright white
// square among muted grey ones.
//
// `active` is state, not selection: it marks a toggle that is currently on.
// Selection between options is still OptionRow/Chip only (see CLAUDE.md).

interface IconButtonProps {
  children: React.ReactNode;
  onClick(): void;
  label: string;
  /** Toggle is on — lights the chip in the accent colour. */
  active?: boolean;
  /** Native title attribute, when it says something the label does not. */
  title?: string;
  pressed?: boolean;
  className?: string;
}

export function IconButton({
  children, onClick, label, active = false, title, pressed, className,
}: IconButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      onClick={() => { hapticImpact('light'); onClick(); }}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={clsx(
        'w-9 h-9 flex items-center justify-center rounded-xl shrink-0',
        'bg-brand-surface border transition-colors',
        active
          ? 'border-brand-accent/50 text-brand-accent'
          : 'border-brand-border text-brand-muted hover:text-white hover:border-brand-accent',
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
