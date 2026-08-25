import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { RatingsList } from '@/features/ratings/RatingsList';

/**
 * Рейтинг футболистов за неделю, месяц и год.
 *
 * ЭКРАН ПОСТРОЕН ПОСЛЕДНИМ, И ЭТО НЕ ОЧЕРЁДНОСТЬ, А УСЛОВИЕ. Данных о голах и
 * пасах в базе не было вообще: `player_stats` — про игроков приложения,
 * `player_seasons` — про просмотры, `player_career` пуст. Сначала появился
 * конвейер (football_scraper/sports_ru_stats.py → player_match_stats),
 * и только потом это.
 *
 * Сам список живёт в `features/ratings/RatingsList` — он же стоит внутри
 * фэнтези. Здесь остались только шапка и роут: две копии списка однажды
 * разошлись бы в числах, а число под футболистом и число в составе игрока
 * обязаны совпадать.
 */
export function RatingsScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-brand-bg pb-24">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={1.5} />
          </button>
          <h1 className="ds-display text-white text-lg font-bold">{t('ratings.title')}</h1>
        </div>

        <RatingsList />
      </div>
    </div>
  );
}
