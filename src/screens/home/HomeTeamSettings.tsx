import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { hapticImpact } from '@/shared/lib/telegram';

interface Props {
  loading: boolean;
  onCreate: () => void;
  onBack: () => void;
}

/**
 * Настройки командной игры.
 *
 * Числа здесь показаны, но не выбираются: у командной игры они пока
 * фиксированы. Показаны намеренно — человек, создающий комнату, должен
 * знать, во что зовёт друзей, а не узнавать это после первого раунда.
 */
export function HomeTeamSettings({ loading, onCreate, onBack }: Props) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-4 animate-slide-up">
      <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-2">
        <p className="text-brand-muted text-sm">{t('home.game_settings')}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: t('home.setting_rounds'), value: '3' },
            { label: t('home.setting_cards'),  value: '5' },
            { label: t('home.setting_time'),   value: '60s' },
          ].map((s) => (
            <div key={s.label} className="bg-brand-border rounded-xl p-2">
              <p className="text-white font-bold">{s.value}</p>
              <p className="text-brand-muted text-xs">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      <Button fullWidth size="lg" loading={loading} onClick={onCreate}>
        {t('home.create_room')}
      </Button>
      <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); onBack(); }}>
        {t('home.back')}
      </Button>
    </div>
  );
}
