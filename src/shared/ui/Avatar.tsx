import { clsx } from 'clsx';
import { AVATAR_COLORS } from './tokens';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
};

// Identity colours, from the brand palette. These used to be eight Tailwind
// defaults that belonged to no palette at all — two of them were a second
// green and a second blue competing with the brand's own.
const COLORS = AVATAR_COLORS;

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function Avatar({ name, src, size = 'md', color, className }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const bg = color ?? colorFromName(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={clsx('rounded-full object-cover flex-shrink-0', sizeClasses[size], className)}
      />
    );
  }

  return (
    <div
      className={clsx(
        'rounded-full flex items-center justify-center font-bold flex-shrink-0',
        sizeClasses[size],
        className,
      )}
      style={{ backgroundColor: bg }}
    >
      {initials}
    </div>
  );
}
