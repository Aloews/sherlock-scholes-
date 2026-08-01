import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { IconPalette } from '@tabler/icons-react';
import { useDesignSwitcher } from '@/shared/design/useDesign';
import { DESIGNS } from '@/shared/design/designs';
import { hapticImpact } from '@/shared/lib/telegram';

interface DesignToggleProps {
  className?: string;
}

/** Flips the app between the two design systems (master ⇄ classic). The choice
 * is persisted per device by settingsStore, so it survives a reload. Sized and
 * styled like the tutorial/sound buttons next to it in the Home header. */
export function DesignToggle({ className }: DesignToggleProps) {
  const { t } = useTranslation();
  const { design, next, toggle } = useDesignSwitcher();

  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      onClick={() => { hapticImpact('light'); toggle(); }}
      aria-label={t('home.design_toggle_aria', { design: t(DESIGNS[next].labelKey) })}
      title={t(DESIGNS[design].labelKey)}
      className={clsx(
        'w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface',
        'border border-brand-border transition-colors',
        // The active design is legible at a glance: the new system lights the
        // button up in the accent, classic leaves it muted.
        design === 'master'
          ? 'border-brand-accent/50 text-brand-accent'
          : 'text-brand-muted hover:text-white hover:border-brand-accent',
        className,
      )}
    >
      <IconPalette size={16} stroke={2} />
    </motion.button>
  );
}
