import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { NewsList } from '@/features/digest/NewsList';
import { TransfersStrip } from '@/features/transfers/TransfersStrip';

/**
 * Новости — свой экран, а не раздел дайджеста.
 *
 * Раньше заголовки и ролики стояли на одной странице и мешали друг другу: за
 * голами приходилось прокручивать новости, а за новостями — видео. Теперь у
 * каждого своя строка на главной и свой повод открыть приложение.
 *
 * Список длиннее, чем был в дайджесте (60 против 30): раздел теперь не делит
 * экран ни с чем, и обрезать его на тридцати незачем.
 */
export function NewsScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('news.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* Переходы идут НАД лентой и только в трансферное окно: вне его блок
            исчезает целиком, а не показывает пустой заголовок. */}
        <TransfersStrip />
        <NewsList />
      </div>
    </div>
  );
}
