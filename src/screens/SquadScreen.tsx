import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconCheck, IconX } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { hapticImpact, hapticError } from '@/shared/lib/telegram';
import { fetchSquadRound, type SquadRound } from '@/features/squad/squadApi';

/**
 * «Чей состав» — 5 игроков одного клуба, тапнуть верный клуб из четырёх.
 *
 * СОСТАВ НЕ ЖИВОЙ. card_current_club — клуб, который игрок не покидал на
 * момент последнего чтения его статьи (current_squads.sql), не сегодняшний
 * список на сайте. Дата под заголовком — не убранство, а условие: тот файл
 * прямым текстом требует «as of», а не намёка на актуальность. Ключ
 * `home.squad_as_of` уже переведён на девять языков — тот же, что в
 * DeckPickerScreen для того же предупреждения, новый заводить незачем.
 */
export function SquadScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [round, setRound] = useState<SquadRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setAnswered(null);
    setRound(await fetchSquadRound(i18n.language));
    setLoading(false);
  }, [i18n.language]);

  useEffect(() => { void load(); }, [load]);

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' });

  const answer = (key: string) => {
    if (answered) return;
    const correct = key === round?.answer_key;
    setAnswered(key);
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
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('squad.title')}</h1>
        {score.total > 0 && (
          <span className="ds-display text-white text-sm font-bold tabular-nums">
            {score.right}/{score.total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {loading && <p className="text-brand-muted text-sm text-center py-8">{t('squad.loading')}</p>}

        {!loading && round === null && (
          <p className="text-brand-muted text-sm text-center py-8">{t('squad.empty')}</p>
        )}

        {!loading && round && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {round.players.map((player) => (
                <div
                  key={player.card_id}
                  className="ds-panel bg-brand-surface border border-brand-border rounded-xl overflow-hidden"
                >
                  <div className="aspect-square w-full bg-brand-border/40">
                    {player.photo_url && (
                      <PlayerPhoto src={player.photo_url} className="w-full h-full" />
                    )}
                  </div>
                  <p className="px-1.5 py-1.5 text-white text-[11px] text-center leading-tight truncate">
                    {player.name}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-brand-muted/70 text-[11px] -mt-1">
              {t('home.squad_as_of', { date: dateFmt.format(new Date(round.fetched_at)) })}
            </p>

            <div className="space-y-2">
              {round.options.map((option) => {
                const isAnswer = option.key === round.answer_key;
                const chosen = answered === option.key;
                // После ответа верный вариант подсвечивается всегда, даже
                // когда выбрали другой — та же логика, что в QuizScreen.
                const tone = !answered
                  ? 'bg-brand-surface border-brand-border'
                  : isAnswer
                    ? 'bg-green-500/15 border-green-500/50'
                    : chosen
                      ? 'bg-red-500/15 border-red-500/50'
                      : 'bg-brand-surface border-brand-border opacity-60';
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={answered !== null}
                    onClick={() => answer(option.key)}
                    className={`w-full ds-panel border rounded-xl p-3 flex items-center gap-2 text-left transition-colors ${tone}`}
                  >
                    <span className="flex-1 min-w-0 truncate text-white text-sm">{option.name}</span>
                    {answered && isAnswer && <IconCheck size={16} className="text-green-400 shrink-0" />}
                    {answered && chosen && !isAnswer && <IconX size={16} className="text-red-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {answered && (
              <Button fullWidth onClick={() => { hapticImpact('light'); void load(); }}>
                {t('squad.next')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
