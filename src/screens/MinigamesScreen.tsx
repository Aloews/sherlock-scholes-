import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { OptionRow } from '@/shared/ui/OptionRow';
import { QuizGame } from '@/screens/minigames/QuizGame';
import { FamousGame } from '@/screens/minigames/FamousGame';
import { SquadGame } from '@/screens/minigames/SquadGame';

/** Ключ игры. Он же значение `?game=` — старые ссылки открываются сразу в игре. */
export type MinigameKey = 'quiz' | 'famous' | 'squad';

const KEYS: readonly MinigameKey[] = ['quiz', 'famous', 'squad'];

function isKey(v: string | null): v is MinigameKey {
  return !!v && (KEYS as readonly string[]).includes(v);
}

/**
 * Мини-игры — ОДИН экран на три.
 *
 * Раньше их было три (`/quiz`, `/famous`, `/squad`), и с главной вели три
 * отдельные ссылки подряд. Игры однотипны: показать вопрос, тапнуть ответ,
 * увидеть счёт, — и три соседние строки в меню читались как три разных раздела,
 * хотя это одна полка. Теперь вход один, игра выбирается внутри и меняется, не
 * выходя.
 *
 * ⚠️ САМИ ИГРЫ НЕ ТРОНУТЫ. `QuizGame`, `FamousGame` и `SquadGame` — прежние
 * экраны целиком, переехавшие в `screens/minigames/` и получившие `onBack`.
 * Запросы, правила и счёт остались как были: свести три экрана в один — не
 * повод переписывать то, что работает.
 *
 * ⚠️ `?game=` СУЩЕСТВУЕТ РАДИ СТАРЫХ ССЫЛОК. `/quiz` и остальные два
 * перенаправляются сюда с этим параметром, поэтому уже открытая где-то ссылка
 * ведёт прямо в игру, а не в меню выбора. Без него перенаправление выглядело бы
 * как «ссылка сломалась и вернула меня в оглавление».
 */
export function MinigamesScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [game, setGame] = useState<MinigameKey | null>(() => {
    const q = params.get('game');
    return isKey(q) ? q : null;
  });

  const back = () => setGame(null);
  if (game === 'quiz') return <QuizGame onBack={back} />;
  if (game === 'famous') return <FamousGame onBack={back} />;
  if (game === 'squad') return <SquadGame onBack={back} />;

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
          <h1 className="ds-display text-white text-xl font-black flex-1">{t('minigames.title')}</h1>
        </div>

        {/* OptionRow с `action`: это вход в игру, а не переключатель настройки,
            и шеврон отличает его от списка галочек — см. шапку OptionRow. */}
        <div className="space-y-2">
          <OptionRow
            leading="❓"
            title={t('quiz.title')}
            description={t('minigames.quiz_hint')}
            action
            onClick={() => { hapticImpact('light'); setGame('quiz'); }}
          />
          <OptionRow
            leading="⚔️"
            title={t('famous.title')}
            description={t('minigames.famous_hint')}
            action
            onClick={() => { hapticImpact('light'); setGame('famous'); }}
          />
          <OptionRow
            leading="👕"
            title={t('squad.title')}
            description={t('minigames.squad_hint')}
            action
            onClick={() => { hapticImpact('light'); setGame('squad'); }}
          />
        </div>
      </div>
    </div>
  );
}
