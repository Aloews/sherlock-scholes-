import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { hapticImpact } from '@/shared/lib/telegram';

interface Props {
  rounds: number;
  onRounds: (n: number) => void;
  loading: boolean;
  onCreate: () => void;
  onBack: () => void;
}

/** Настройки игры один на один. Раунды здесь выбираются — в отличие от командной. */
export function HomeDuelSettings({ rounds, onRounds, loading, onCreate, onBack }: Props) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-4 animate-slide-up">
      <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-4">
        <p className="text-brand-muted text-sm">{t('home.game_settings')}</p>
        <div>
          <p className="text-white text-sm font-medium mb-2">{t('home.setting_rounds')}</p>
          <div className="grid grid-cols-3 gap-2">
            {[3, 5, 7].map((n) => (
              <button
                key={n}
                className={`rounded-xl py-2 text-center font-bold transition-colors ${
                  rounds === n
                    ? 'bg-brand-accent text-brand-bg'
                    : 'bg-brand-border text-white hover:bg-brand-border/70'
                }`}
                onClick={() => { hapticImpact('light'); onRounds(n); }}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Раунд здесь — это объяснение КАЖДОМУ, а не всего: без подписи
              «3» читается как «три хода на двоих» и игра кажется вдвое короче
              обещанного. */}
          <p className="text-brand-muted/60 text-xs mt-2">{t('home.setting_rounds_1v1_hint')}</p>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-brand-muted">{t('home.setting_time')}</span>
          <span className="text-white">60s</span>
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
