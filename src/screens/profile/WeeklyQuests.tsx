import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { IconCheck, IconGift } from '@tabler/icons-react';
import { fetchWeeklyQuests, claimWeeklyQuest } from '@/features/quests/questsApi';
import { questState, questPct, daysLeftInWeek } from '@/shared/lib/quests';
import { hapticImpact } from '@/shared/lib/telegram';
import type { WeeklyQuest } from '@/shared/types/database';

/**
 * The week's three quests. Which three is decided by the server
 * (weekly_task_codes in supabase/migrations/weekly_quests.sql) and the same
 * for everyone — this component only draws what it is handed.
 */
export function WeeklyQuests({ playerId, onClaimed }: {
  playerId: number | null;
  /** Fires after a successful claim so the caller can refetch xp. */
  onClaimed?: (xp: number) => void;
}) {
  const { t } = useTranslation();
  const [quests, setQuests] = useState<WeeklyQuest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(() => {
    if (playerId === null) return;
    fetchWeeklyQuests(playerId)
      .then((q) => { setQuests(q); setFailed(false); })
      .catch(() => setFailed(true));
  }, [playerId]);

  useEffect(() => { load(); }, [load]);

  const claim = async (code: string) => {
    if (playerId === null || claiming) return;
    setClaiming(code);
    try {
      const xp = await claimWeeklyQuest(playerId, code);
      if (xp > 0) {
        hapticImpact('medium');
        onClaimed?.(xp);
      }
      // Refetch either way: a 0 means the server disagreed with what we drew,
      // so the honest response is to show its answer rather than ours.
      load();
    } catch {
      setFailed(true);
    } finally {
      setClaiming(null);
    }
  };

  // A player with no id (not signed in) gets nothing at all, not an error.
  if (playerId === null || failed) return null;

  if (quests === null) {
    return (
      <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
        <div className="h-4 w-1/3 rounded bg-brand-border/40 animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-2/3 rounded bg-brand-border/40 animate-pulse" />
            <div className="h-1.5 w-full rounded-full bg-brand-border/40 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (quests.length === 0) return null;

  const daysLeft = daysLeftInWeek(quests[0].week_start);

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="ds-display text-base font-bold text-white">{t('quests.title')}</h2>
        <span className="text-[10.5px] text-brand-muted shrink-0">
          {t('quests.days_left', { count: daysLeft })}
        </span>
      </div>

      <ul className="space-y-3.5">
        {quests.map((q) => {
          const state = questState(q);
          const pct = questPct(q);
          return (
            <li key={q.code}>
              <div className="flex items-center justify-between gap-2">
                <p className={clsx('text-xs', state === 'claimed' ? 'text-brand-muted' : 'text-white')}>
                  {t(`quests.metric.${q.metric}`, { count: q.target })}
                </p>
                {state === 'claimed' ? (
                  <span className="flex items-center gap-1 text-[10.5px] text-brand-muted shrink-0">
                    <IconCheck size={12} stroke={2.5} />
                    {t('quests.claimed')}
                  </span>
                ) : state === 'ready' ? (
                  <button
                    type="button"
                    onClick={() => claim(q.code)}
                    disabled={claiming !== null}
                    className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[10.5px] font-medium
                               border border-brand-accent bg-brand-accent/15 text-white shrink-0
                               disabled:opacity-40 transition-colors"
                  >
                    <IconGift size={12} stroke={2} />
                    {t('quests.claim', { xp: q.reward_xp })}
                  </button>
                ) : (
                  <span className="text-[10.5px] text-brand-muted shrink-0 tabular-nums">
                    {q.progress}/{q.target}
                  </span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-brand-border overflow-hidden mt-1.5">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    // A claimed quest keeps its full bar but drops the accent —
                    // it is history, and the accent belongs to what is actionable.
                    background: state === 'claimed' ? 'rgb(var(--brand-border))' : 'var(--accent-gradient)',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
