import { clsx } from 'clsx';

interface TimerProps {
  remaining: number;
  total: number;
  size?: 'sm' | 'lg';
}

export function Timer({ remaining, total, size = 'lg' }: TimerProps) {
  const pct = remaining / total;
  const isDanger  = remaining <= 5;
  const isWarning = remaining <= 10 && !isDanger;

  const radius = size === 'lg' ? 44 : 28;
  const stroke = size === 'lg' ? 6 : 4;
  const dim    = (radius + stroke) * 2;
  const circ   = 2 * Math.PI * radius;
  const offset = circ * (1 - pct);

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="#27272a"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke={isDanger ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span
        className={clsx(
          'absolute font-black tabular-nums',
          size === 'lg' ? 'text-4xl' : 'text-xl',
          isDanger  && 'text-red-400 animate-pulse-fast',
          isWarning && 'text-amber-400',
          !isDanger && !isWarning && 'text-white',
        )}
      >
        {remaining}
      </span>
    </div>
  );
}
