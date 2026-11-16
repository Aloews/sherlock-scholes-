import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getDoctrineProgress,
  submitDoctrineAnswer,
  type DoctrineProgress,
} from '@/features/football-dynasty/api';
import {
  machiavelliPrinciples,
  type DoctrineChoiceId,
  type MachiavelliPrinciple,
} from '@/features/football-dynasty/machiavelliPrinciples';

interface Props {
  campaignId: string;
}

export function MachiavelliAcademy({ campaignId }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const principles = machiavelliPrinciples[locale];
  const [progress, setProgress] = useState<DoctrineProgress | null>(null);
  const [selectedId, setSelectedId] = useState(1);
  const [selectedChoice, setSelectedChoice] = useState<DoctrineChoiceId | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getDoctrineProgress(campaignId)
      .then((value) => {
        if (!active) return;
        setProgress(value);
        setSelectedId(value.unlocked_principle_id ?? 18);
      })
      .catch(() => {
        if (active) setError(t('machiavelli.error'));
      });
    return () => { active = false; };
  }, [campaignId, t]);

  const completedById = useMemo(
    () => new Map((progress?.completed ?? []).map((item) => [item.principle_id, item])),
    [progress],
  );
  const current = principles.find((item) => item.id === selectedId);
  const completion = completedById.get(selectedId);
  const chosenOption = completion && current
    ? current.choices.find((choice) => choice.id === completion.choice_id)
    : undefined;

  const selectPrinciple = (principle: MachiavelliPrinciple) => {
    if (principle.id > (progress?.unlocked_principle_id ?? 19) && !completedById.has(principle.id)) return;
    setSelectedId(principle.id);
    setSelectedChoice('');
    setError('');
  };

  const submit = async () => {
    if (!selectedChoice || !current || completion || busy) return;
    setBusy(true);
    setError('');
    try {
      const answer = await submitDoctrineAnswer(campaignId, current.id, selectedChoice);
      setProgress((previous) => previous ? {
        ...previous,
        completed: [...previous.completed, {
          principle_id: answer.principle_id,
          choice_id: answer.choice_id,
          score: answer.score,
          completed_at: answer.completed_at,
        }],
        completed_count: answer.completed_count,
        total_score: previous.total_score + answer.score,
        unlocked_principle_id: answer.unlocked_principle_id,
      } : previous);
    } catch {
      setError(t('machiavelli.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!progress) {
    return (
      <section className="mb-6 rounded-2xl border border-brand-border bg-brand-surface p-5 text-sm text-brand-muted" aria-live="polite">
        {error || t('machiavelli.loading')}
      </section>
    );
  }

  const finished = progress.completed_count === progress.total_principles;

  return (
    <section className="mb-6 rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6" dir={i18n.dir()}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">{t('machiavelli.eyebrow')}</p>
          <h3 className="text-xl font-semibold">{t('machiavelli.title')}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-muted">{t('machiavelli.subtitle')}</p>
        </div>
        <div className="rounded-xl border border-brand-border bg-brand-bg px-3 py-2 text-sm tabular-nums">
          <span className="font-semibold text-white">{progress.completed_count}</span>
          <span className="text-brand-muted"> / {progress.total_principles}</span>
        </div>
      </div>

      <div className="mb-5 h-2 overflow-hidden rounded-full bg-brand-bg" role="progressbar"
        aria-valuemin={0} aria-valuemax={progress.total_principles} aria-valuenow={progress.completed_count}
        aria-label={t('machiavelli.progress')}>
        <div className="h-full rounded-full bg-brand-accent transition-all" style={{ width: (progress.completed_count / progress.total_principles) * 100 + '%' }} />
      </div>

      <div className="mb-5 grid grid-cols-6 gap-2 sm:grid-cols-9">
        {principles.map((principle) => {
          const done = completedById.has(principle.id);
          const unlocked = principle.id === progress.unlocked_principle_id;
          const active = principle.id === selectedId;
          const locked = !done && !unlocked;
          return (
            <button
              key={principle.id}
              type="button"
              disabled={locked}
              onClick={() => selectPrinciple(principle)}
              aria-label={t('machiavelli.principle') + ' ' + principle.id + (done ? ', ' + t('machiavelli.completed') : locked ? ', ' + t('machiavelli.locked') : '')}
              aria-pressed={active}
              className={'flex min-h-10 items-center justify-center rounded-lg border text-sm font-semibold transition ' + (
                active ? 'border-brand-accent bg-brand-accent/15 text-white'
                  : done ? 'border-brand-accent/40 bg-brand-bg text-brand-accent'
                    : locked ? 'cursor-not-allowed border-brand-border/50 bg-brand-bg/50 text-brand-muted/40'
                      : 'border-brand-border bg-brand-bg text-brand-muted hover:border-brand-accent/60'
              )}
            >
              {principle.id}
            </button>
          );
        })}
      </div>

      {finished && !completion ? (
        <div className="rounded-xl border border-brand-accent/30 bg-brand-bg p-5">
          <h4 className="text-lg font-semibold">{t('machiavelli.finishedTitle')}</h4>
          <p className="mt-2 text-sm leading-6 text-brand-muted">{t('machiavelli.finishedText')}</p>
          <p className="mt-3 text-sm font-semibold text-brand-accent">{t('machiavelli.totalScore')}: {progress.total_score} / 36</p>
        </div>
      ) : current ? (
        <div className="rounded-xl border border-brand-border bg-brand-bg p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-brand-muted">
            <span>{t('machiavelli.principle')} {current.id}</span>
            <span aria-hidden="true">·</span>
            <span>{current.source}</span>
          </div>
          <h4 className="text-lg font-semibold leading-snug">{current.title}</h4>
          <p className="mt-3 text-sm leading-6 text-brand-muted">{current.idea}</p>

          <div className="mt-5 rounded-xl border border-brand-border bg-brand-surface p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-accent">{t('machiavelli.scenario')}</p>
            <p className="text-sm leading-6">{current.scenario}</p>
          </div>

          {completion && chosenOption ? (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-brand-accent/30 bg-brand-accent/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-accent">{t('machiavelli.yourDecision')}</span>
                  <span className="text-sm font-semibold tabular-nums">{t('machiavelli.score')}: {completion.score} / 2</span>
                </div>
                <p className="mt-2 text-sm font-medium">{chosenOption.label}</p>
                <p className="mt-2 text-sm leading-6 text-brand-muted">{chosenOption.consequence}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-accent">{t('machiavelli.takeaway')}</p>
                <p className="text-sm leading-6">{current.takeaway}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 mt-5 text-sm font-semibold">{t('machiavelli.choose')}</p>
              <div className="space-y-2">
                {current.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={selectedChoice === choice.id}
                    onClick={() => setSelectedChoice(choice.id)}
                    className={'w-full rounded-xl border p-3 text-start text-sm leading-6 transition ' + (
                      selectedChoice === choice.id
                        ? 'border-brand-accent bg-brand-accent/10 text-white'
                        : 'border-brand-border bg-brand-surface text-brand-muted hover:border-brand-accent/50 hover:text-white'
                    )}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              {selectedChoice && (
                <div className="mt-3 rounded-lg bg-brand-surface p-3 text-sm leading-6 text-brand-muted">
                  {current.choices.find((choice) => choice.id === selectedChoice)?.consequence}
                </div>
              )}
              <button
                type="button"
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void submit()}
                disabled={!selectedChoice || busy}
              >
                {busy ? t('machiavelli.loading') : t('machiavelli.submit')}
              </button>
            </>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-brand-muted">
        <span>{t('machiavelli.scoreMeaning')}</span>
        <span className="tabular-nums">{t('machiavelli.totalScore')}: {progress.total_score} / 36</span>
      </div>
    </section>
  );
}
