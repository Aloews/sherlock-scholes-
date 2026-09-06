import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * Шапка неигрового экрана: «назад» и заголовок.
 *
 * Владелец: «добавь кнопку назад в вне игровых экранах для навигации, и создай
 * систему навигации, так как приложение очень большое».
 *
 * ⚠️ ЭКРАНОВ СТАЛО ДВАДЦАТЬ ТРИ, И У ОДИННАДЦАТИ «НАЗАД» НЕ БЫЛО ВОВСЕ —
 * это замер, а не впечатление: коллекция, колода, друзья, профиль, админка,
 * обучение. В Telegram Mini App системной кнопки «назад» нет, поэтому выйти с
 * такого экрана можно было только через нижнее меню, если оно там есть.
 *
 * ⚠️ НА ИГРОВЫХ ЭКРАНАХ ЕЁ БЫТЬ НЕ ДОЛЖНО, и это не забывчивость. Из игры,
 * лобби, обучения и финального экрана «назад» уводит в середину партии: раунд
 * идёт, счёт живой, а половина состояния лежит в комнате. Владелец так и
 * сказал — «в ВНЕ ИГРОВЫХ экранах».
 *
 * КУДА ВЕДЁТ. По умолчанию `navigate(-1)` — назад по истории, то есть туда,
 * откуда пришли: экран клуба открывают и из коллекции, и из рейтинга, и из
 * матчей, и жёсткий адрес увёл бы двоих из троих не туда. `to` задаётся
 * явно только там, где истории может не быть — на экране, открытом по прямой
 * ссылке.
 */
export function ScreenHeader({ title, to, right }: {
  title: string;
  /** Куда вести вместо истории. По умолчанию — назад по истории. */
  to?: string;
  /** Что показать справа: фильтр, счётчик, кнопка. */
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 px-4 pt-3 pb-2">
      <button
        type="button"
        onClick={() => {
          hapticImpact('light');
          // ⚠️ `navigate(-1)` при пустой истории не делает НИЧЕГО, и экран
          // выглядит зависшим. Такое бывает у карточки, открытой по прямой
          // ссылке из Telegram: она первая в истории. Поэтому запасной путь —
          // на главную, а не молчание.
          if (to) navigate(to);
          else if (window.history.length > 1) navigate(-1);
          else navigate('/');
        }}
        className="text-brand-muted hover:text-white transition-colors shrink-0"
        aria-label={t('home.back')}
      >
        <IconArrowLeft size={22} stroke={2} />
      </button>
      <h1 className="ds-display text-white text-xl font-black flex-1 truncate">{title}</h1>
      {right}
    </div>
  );
}
