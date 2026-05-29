import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import type { TeamScore } from '@/shared/types/database';

function AnimatedCounter({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed  = (Date.now() - start) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <>{display}</>;
}

interface ScoreboardProps {
  scores: TeamScore[];
  compact?: boolean;
  showWinner?: boolean;
  animated?: boolean;
}

export function Scoreboard({ scores, compact = false, showWinner = false, animated = false }: ScoreboardProps) {
  const sorted    = [...scores].sort((a, b) => b.total_points - a.total_points);
  const maxPoints = sorted[0]?.total_points ?? 0;

  if (compact) {
    return (
      <div className="flex gap-3">
        {sorted.map((s) => (
          <div key={s.team_id} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-sm font-bold text-white">{s.total_points}</span>
            <span className="text-xs text-brand-muted">{s.team_name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((s, i) => {
        const isWinner = showWinner && i === 0 && s.total_points === maxPoints;
        const barWidth = maxPoints > 0 ? (s.total_points / maxPoints) * 100 : 0;

        return (
          <div
            key={s.team_id}
            className={clsx(
              'rounded-2xl p-4 border',
              isWinner
                ? 'bg-brand-accent/10 border-brand-accent/30'
                : 'bg-brand-surface border-brand-border',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {isWinner && <span>🏆</span>}
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                <span className={clsx('font-semibold', isWinner ? 'text-brand-accent' : 'text-white')}>
                  {s.team_name}
                </span>
              </div>
              <span className={clsx('text-2xl font-black', isWinner ? 'text-brand-accent' : 'text-white')}>
                {animated ? <AnimatedCounter value={s.total_points} /> : s.total_points}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-brand-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${barWidth}%`, backgroundColor: s.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
