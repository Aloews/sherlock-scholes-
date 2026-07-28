import { useDesign } from '@/shared/design/useDesign';

interface TimerProps {
  remaining: number;
  total: number;
  size?: 'sm' | 'lg';
}

export function Timer({ remaining, total, size = 'lg' }: TimerProps) {
  const master    = useDesign() === 'master';
  const pct       = remaining / total;
  const isPulsing = remaining <= 10;

  // The master design's ring is thinner and its track is a faint white rather
  // than the border token — the prototype's proportions.
  const radius = size === 'lg' ? 44 : 28;
  const stroke = size === 'lg' ? (master ? 5 : 6) : 4;
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
          stroke={master ? 'rgba(255,255,255,.06)' : 'rgb(var(--brand-border))'}
          strokeWidth={stroke}
        />
        {/* Progress — always brand accent (design-system token) */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--brand-accent))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span
        className={`absolute tabular-nums text-white ${master ? 'ds-display font-extrabold' : 'font-black'} ${
          size === 'lg' ? 'text-4xl' : 'text-xl'
        } ${isPulsing ? 'animate-pulse-fast' : ''}`}
      >
        {remaining}
      </span>
    </div>
  );
}
