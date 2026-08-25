import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconCheck, IconX } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { hapticImpact, hapticError } from '@/shared/lib/telegram';
import { fetchQuizRound, type PlayerFacts, type QuizRound } from '@/features/quiz/quizApi';

/**
 * «Угадай игрока по фактам».
 *
 * Кормится из cards.facts — рост, год рождения, число клубов, сборная,
 * турниры. Ничего нового собирать не пришлось: конвейер существовал, и это
 * выяснилось только после того, как я ошибся в проверке и сказал обратное.
 *
 * ФАКТЫ ПОКАЗЫВАЮТСЯ ПО ОДНОМУ, а не все сразу. Полный список решает вопрос
 * мгновенно и без интереса; открывать по одному — это и есть игра, и это же
 * честная шкала сложности вместо выдуманной.
 *
 * ФОТО НЕ ПОКАЗЫВАЕТСЯ. Оно есть в данных, и оно же убивает вопрос: узнать
 * лицо не то же самое, что вывести человека из фактов.
 */
export function QuizGame({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();

  const [round, setRound] = useState<QuizRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(1);
  const [answered, setAnswered] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setAnswered(null);
    setRevealed(1);
    setRound(await fetchQuizRound());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const lines = round ? factLines(round.facts, t) : [];

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
          onClick={() => { hapticImpact('light'); onBack(); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('quiz.title')}</h1>
        {score.total > 0 && (
          <span className="ds-display text-white text-sm font-bold tabular-nums">
            {score.right}/{score.total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {loading && <p className="text-brand-muted text-sm text-center py-8">{t('quiz.loading')}</p>}

        {!loading && round === null && (
          <p className="text-brand-muted text-sm text-center py-8">{t('quiz.empty')}</p>
        )}

        {!loading && round && (
          <>
            <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
              {lines.slice(0, revealed).map((line) => (
                <p key={line} className="text-white text-sm">{line}</p>
              ))}

              {revealed < lines.length && !answered && (
                <button
                  type="button"
                  onClick={() => { hapticImpact('light'); setRevealed((n) => n + 1); }}
                  className="text-brand-accent text-xs"
                >
                  {t('quiz.more_facts')}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {round.options.map((option) => {
                const isAnswer = option.id === round.answer_id;
                const chosen = answered === option.id;
                // После ответа правильный вариант подсвечивается всегда, даже
                // когда выбрали другой: иначе игра сообщает «неверно» и не
                // говорит, как было на самом деле.
                const tone = !answered
                  ? 'bg-brand-surface border-brand-border'
                  : isAnswer
                    ? 'bg-green-500/15 border-green-500/50'
                    : chosen
                      ? 'bg-red-500/15 border-red-500/50'
                      : 'bg-brand-surface border-brand-border opacity-60';
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={answered !== null}
                    onClick={() => answer(option.id)}
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
                {t('quiz.next')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Факты в порядке «от общего к решающему».
 *
 * Позиция и год рождения сужают круг слабо, сборная и турниры — сильно. Порядок
 * не косметический: он и есть шкала сложности, и открывать сборную первой
 * значило бы отдавать ответ на первом шаге.
 */
function factLines(facts: PlayerFacts, t: (key: string, opts?: Record<string, unknown>) => string): string[] {
  const lines: string[] = [];
  if (facts.position)      lines.push(t('quiz.fact_position', { value: facts.position }));
  if (facts.birth_year)    lines.push(t('quiz.fact_born', { value: facts.birth_year }));
  if (facts.height_cm)     lines.push(t('quiz.fact_height', { value: facts.height_cm }));
  if (facts.clubs_count)   lines.push(t('quiz.fact_clubs', { value: facts.clubs_count }));
  if (facts.years_active)  lines.push(t('quiz.fact_years', { value: facts.years_active }));
  if (facts.national_team) lines.push(t('quiz.fact_national', { value: facts.national_team }));
  if (facts.national_caps) lines.push(t('quiz.fact_caps', { value: facts.national_caps }));
  if (facts.tournaments?.length) {
    lines.push(t('quiz.fact_tournaments', { value: facts.tournaments.slice(0, 3).join(', ') }));
  }
  return lines;
}
