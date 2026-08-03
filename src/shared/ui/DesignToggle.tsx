import { useTranslation } from 'react-i18next';
import { IconPalette } from '@tabler/icons-react';
import { useDesignSwitcher } from '@/shared/design/useDesign';
import { DESIGNS } from '@/shared/design/designs';
import { IconButton } from '@/shared/ui/IconButton';

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
    <IconButton
      onClick={toggle}
      label={t('home.design_toggle_aria', { design: t(DESIGNS[next].labelKey) })}
      title={t(DESIGNS[design].labelKey)}
      // The active design is legible at a glance: the new system lights the
      // button up in the accent, classic leaves it muted.
      active={design === 'master'}
      className={className}
    >
      <IconPalette size={17} stroke={1.75} />
    </IconButton>
  );
}
