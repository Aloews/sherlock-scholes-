import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RatingsList } from '@/features/ratings/RatingsList';
import { PlayerIndexList } from '@/features/ratings/PlayerIndexList';
import { RisingList } from '@/features/ratings/RisingList';
import { Chip } from '@/shared/ui/Chip';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * Статистика футболистов. Половина раздела «Коллекция».
 *
 * ЭТОТ РАЗДЕЛ ПОСТРОЕН ПОСЛЕДНИМ, И ЭТО НЕ ОЧЕРЁДНОСТЬ, А УСЛОВИЕ. Данных о
 * голах и пасах в базе не было вообще: `player_stats` — про игроков
 * приложения, `player_seasons` — про просмотры, `player_career` пуст. Сначала
 * появился конвейер (football_scraper/sports_ru_stats.py →
 * player_match_stats), и только потом это.
 *
 * Сами списки живут в `features/ratings/*` — те же стоят внутри фэнтези.
 * Здесь только переключатель: две копии списка однажды разошлись бы в числах,
 * а число под футболистом и число в составе игрока обязаны совпадать.
 *
 * ТРИ СПИСКА, А НЕ ОДИН С ПЕРЕКЛЮЧАТЕЛЕМ ВНУТРИ, и это разные вопросы:
 * «Общий» отвечает, кто вообще значительнее — стоимость, просмотры, минуты,
 * новости, без окна; «По игре» — кто играл лучше за неделю или месяц; «Кто
 * набирает ход» — у кого числа выросли. Сложить форму за семь дней с карьерой
 * за пятнадцать лет в одно число нельзя, поэтому и число у них своё.
 */
export function StatsPane() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'index' | 'form' | 'rising'>('index');

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <Chip
          label={t('index.tab_index')}
          selected={tab === 'index'}
          onClick={() => { hapticImpact('light'); setTab('index'); }}
        />
        <Chip
          label={t('index.tab_form')}
          selected={tab === 'form'}
          onClick={() => { hapticImpact('light'); setTab('form'); }}
        />
        <Chip
          label={t('rising.tab')}
          selected={tab === 'rising'}
          onClick={() => { hapticImpact('light'); setTab('rising'); }}
        />
      </div>

      {tab === 'index' && <PlayerIndexList />}
      {tab === 'form' && <RatingsList />}
      {tab === 'rising' && <RisingList />}
    </div>
  );
}
