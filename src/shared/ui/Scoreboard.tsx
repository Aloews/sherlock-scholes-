import { clsx } from 'clsx';
import type { TeamScore } from '@/shared/types/database';

interface ScoreboardProps {
  scores: TeamScore[];
  compact?: boolean;
  showWinner?: boolean;
}

export function Scoreboard({ scores, compact = false, showWinner = false }: ScoreboardProps) {
  const sorted = [...scores].sort((a, b) => b.total_points - a.total_points);
  const maxPoints = sorted[0]?.total_points ?? 0;

  if (compact) {
    return (
      <div className="flex gap-3">
        {sorted.map((s) => (
          <div key={s.team_id} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-sm font-bold text-white">{s.total_points}</span>
            <span className="text-xs text-zinc-500">{s.team_name}</span>
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
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-zinc-900 border-zinc-800',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {isWinner && <span>🏆</span>}
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className={clsx('font-semibold', isWinner ? 'text-emerald-400' : 'text-white')}>
                  {s.team_name}
                </span>
              </div>
              <span className={clsx('text-2xl font-black', isWinner ? 'text-emerald-400' : 'text-white')}>
                {s.total_points}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
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
