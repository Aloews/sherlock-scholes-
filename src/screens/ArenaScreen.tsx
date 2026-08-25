import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { OptionRow } from '@/shared/ui/OptionRow';
import { readRoom } from '@/features/arena/arenaSession';
import { ArenaLocal } from '@/screens/arena/ArenaLocal';
import { ArenaOnline } from '@/screens/arena/ArenaOnline';

type Mode = 'local' | 'online';

/**
 * Арена — ОДИН экран на оба режима.
 *
 * Раньше их было два: `/arena` (на одном телефоне) и `/arena/online` (на двух),
 * и с главной на них вели две отдельные ссылки. Игра одна и та же, разница
 * только в том, где сидит второй игрок, — а выбор был сделан ещё на главной, до
 * того как игрок вообще увидел арену. Теперь вход один, а режим выбирается
 * внутри и меняется, не выходя.
 *
 * ⚠️ САМА ИГРА НЕ ТРОНУТА. `ArenaLocal` и `ArenaOnline` — это прежние экраны
 * целиком, переехавшие в `screens/arena/` и получившие `onBack`. Физика,
 * сеть и рейтинг остались как были: свести два экрана в один — не повод
 * переписывать то, что работает.
 *
 * ⚠️ НАЧАТАЯ ОНЛАЙН-ИГРА ПЕРЕБИВАЕТ ВЫБОР. `arenaSession` помнит комнату между
 * перезагрузками, и если она есть — игрок возвращается в матч, а не в меню:
 * показать выбор режима человеку, у которого идёт игра, значит потерять её.
 */
export function ArenaScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Читаем комнату ОДИН раз, при первом рендере: последующее её исчезновение
  // (игрок вышел из матча) не должно выкидывать его из режима сию секунду.
  const [mode, setMode] = useState<Mode | null>(() => (readRoom() ? 'online' : null));

  if (mode === 'local') return <ArenaLocal onBack={() => setMode(null)} />;
  if (mode === 'online') return <ArenaOnline onBack={() => setMode(null)} />;

  return (
    <div className="min-h-screen bg-brand-bg ds-screen">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/'); }}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={2} />
          </button>
          <h1 className="ds-display text-white text-lg font-black flex-1">{t('arena.title')}</h1>
        </div>

        <p className="text-brand-muted text-[12px] leading-snug">{t('arena.mode_hint')}</p>

        {/* OptionRow с `action`: это не переключатель настройки, а вход в игру,
            и шеврон отличает его от списка галочек — см. шапку OptionRow. */}
        <div className="space-y-2">
          <OptionRow
            leading="📱"
            title={t('arena.mode_local')}
            description={t('arena.mode_local_hint')}
            action
            onClick={() => { hapticImpact('light'); setMode('local'); }}
          />
          <OptionRow
            leading="🌐"
            title={t('arena.mode_online')}
            description={t('arena.mode_online_hint')}
            action
            onClick={() => { hapticImpact('light'); setMode('online'); }}
          />
        </div>
      </div>
    </div>
  );
}
