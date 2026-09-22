import { useTranslation } from 'react-i18next';
import { IconPalette } from '@tabler/icons-react';
import { useDesignSwitcher } from '@/shared/design/useDesign';
import { DESIGNS } from '@/shared/design/designs';
import { IconButton } from '@/shared/ui/IconButton';

interface DesignToggleProps {
  className?: string;
}

/** Перебирает дизайны по кругу: master → classic → paper → master. Выбор
 * хранится на устройстве (settingsStore) и переживает перезагрузку. Размер и
 * вид — как у соседних кнопок обучения и звука в шапке главной.
 *
 * Подпись называет СЛЕДУЮЩИЙ дизайн, а не «другой», поэтому появление
 * третьего её не сломало: она и раньше подставляла имя из DESIGNS. */
export function DesignToggle({ className }: DesignToggleProps) {
  const { t } = useTranslation();
  const { design, next, toggle } = useDesignSwitcher();

  return (
    <IconButton
      onClick={toggle}
      label={t('home.design_toggle_aria', { design: t(DESIGNS[next].labelKey) })}
      title={t(DESIGNS[design].labelKey)}
      // ⚠️ ПОДСВЕТКА ОСТАЛАСЬ ПРЕЖНЕЙ ДЛЯ ДВУХ СТАРЫХ ДИЗАЙНОВ, И ЭТО
      // НАМЕРЕННО. Она означала «включён не классический вид»; с приходом
      // бумаги проще всего было бы написать `=== 'master'`, но тогда бумага
      // читалась бы как классика, то есть как «ничего не выбрано».
      active={design !== 'classic'}
      className={className}
    >
      <IconPalette size={17} stroke={1.75} />
    </IconButton>
  );
}
