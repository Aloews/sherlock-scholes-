interface TimerProps {
  remaining: number;
  total: number;
  size?: 'sm' | 'lg';
}

export function Timer({ remaining, total, size = 'lg' }: TimerProps) {
  const pct       = remaining / total;
  const isPulsing = remaining <= 10;

  const radius = size === 'lg' ? 44 : 28;
  const stroke = size === 'lg' ? 6  : 4;
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
          stroke="#1F2740"
          strokeWidth={stroke}
        />
        {/* Progress — always brand accent */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="#FF6300"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span
        className={`absolute font-black tabular-nums text-white ${
          size === 'lg' ? 'text-4xl' : 'text-xl'
        } ${isPulsing ? 'animate-pulse-fast' : ''}`}
      >
        {remaining}
      </span>
    </div>
  );
}
