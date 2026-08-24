import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconCheck, IconX } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { hapticImpact, hapticError } from '@/shared/lib/telegram';
import { fetchFamousRound, type FamousRound } from '@/features/famous/famousApi';

/**
 * «Кто известнее» — две карточки, тапнуть более известную.
 *
 * НЕ PlayerCard. У PlayerCard рамка красится по cards.tier, а tier — это
 * fame_tier(fame), та же ось, что и ответ этой игры: покажи здесь настоящую
 * рамку редкости, и она выдаст, кто известнее, раньше, чем игрок посмотрит
 * на фото. Плитка ниже — своя, без рамки, только фото и имя.
 *
 * Рамка выбора повторяет QuizScreen: до ответа нейтральная, после — зелёная
 * у верной карточки всегда (даже если выбрали другую — иначе игра говорит
 * «неверно» и не говорит, как было на самом деле), красная у выбранной
 * неверной.
 */
export function FamousScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [round, setRound] = useState<FamousRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setAnswered(null);
    setRound(await fetchFamousRound(i18n.language));
    setLoading(false);
  }, [i18n.language]);

  useEffect(() => { void load(); }, [load]);

  const answer = (optionId: string) => {
    if (answered) return;
    const correct = optionId === round?.answer_id;
    setAnswered(optionId);
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
    if (correct) hapticImpact('medium'); else hapticError();
  };

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
        <div className="flex-1 min-w-0">
          <h1 className="ds-display text-white text-xl font-black truncate">{t('famous.title')}</h1>
          <p className="text-brand-muted text-[11px]">{t('famous.subtitle')}</p>
        </div>
        {score.total > 0 && (
          <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0">
            {score.right}/{score.total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {loading && <p className="text-brand-muted text-sm text-center py-8">{t('famous.loading')}</p>}

        {!loading && round === null && (
          <p className="text-brand-muted text-sm text-center py-8">{t('famous.empty')}</p>
        )}

        {!loading && round && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {round.options.map((option) => {
                const isAnswer = option.id === round.answer_id;
                const chosen = answered === option.id;
                const tone = !answered
                  ? 'border-brand-border'
                  : isAnswer
                    ? 'border-green-500/50'
                    : chosen
                      ? 'border-red-500/50'
                      : 'border-brand-border opacity-60';
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={answered !== null}
                    onClick={() => answer(option.id)}
                    className={`ds-panel bg-brand-surface border rounded-2xl overflow-hidden text-left transition-colors ${tone}`}
                  >
                    <div className="aspect-square w-full bg-brand-border/40">
                      {option.photo_url && (
                        <PlayerPhoto src={option.photo_url} className="w-full h-full" />
                      )}
                    </div>
                    <div className="px-2.5 py-2 flex items-center gap-1.5">
                      <span className="flex-1 min-w-0 truncate text-white text-sm">{option.name}</span>
                      {answered && isAnswer && <IconCheck size={16} className="text-green-400 shrink-0" />}
                      {answered && chosen && !isAnswer && <IconX size={16} className="text-red-400 shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {answered && (
              <Button fullWidth className="mt-4" onClick={() => { hapticImpact('light'); void load(); }}>
                {t('famous.next')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
