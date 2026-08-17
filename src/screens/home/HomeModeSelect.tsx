import { useTranslation } from 'react-i18next';
import { IconUsersGroup, IconUser } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { hapticImpact } from '@/shared/lib/telegram';

interface Props {
  onTeam: () => void;
  onOneVsOne: () => void;
  onBack: () => void;
}

/** Соревновательный режим: командная игра или один на один. */
export function HomeModeSelect({ onTeam, onOneVsOne, onBack }: Props) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-3 animate-slide-up">
      <p className="text-brand-muted text-xs text-center uppercase tracking-wider mb-1">
        {t('home.competitive_mode')}
      </p>

      <button
        className="w-full bg-brand-surface border border-brand-border rounded-2xl p-5 text-left hover:border-brand-accent transition-colors"
        onClick={() => { hapticImpact('light'); onTeam(); }}
      >
        <div className="flex items-start gap-4">
          <div className="mt-0.5 text-brand-accent flex-shrink-0">
            <IconUsersGroup size={28} stroke={1.5} />
          </div>
          <div>
            <p className="text-white font-bold">{t('home.mode_team_title')}</p>
            <p className="text-brand-muted text-sm mt-0.5">{t('home.mode_team_desc')}</p>
          </div>
        </div>
      </button>

      <button
        className="w-full bg-brand-surface border border-brand-border rounded-2xl p-5 text-left hover:border-brand-accent transition-colors"
        onClick={() => { hapticImpact('light'); onOneVsOne(); }}
      >
        <div className="flex items-start gap-4">
          <div className="mt-0.5 text-brand-accent flex-shrink-0">
            <IconUser size={28} stroke={1.5} />
          </div>
          <div>
            <p className="text-white font-bold">{t('home.mode_1v1_title')}</p>
            <p className="text-brand-muted text-sm mt-0.5">{t('home.mode_1v1_desc')}</p>
          </div>
        </div>
      </button>

      <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); onBack(); }}>
        {t('home.back')}
      </Button>
    </div>
  );
}
