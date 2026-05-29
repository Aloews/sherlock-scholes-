import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:   'bg-brand-accent hover:opacity-90 text-brand-bg font-medium',
  secondary: 'bg-transparent border border-brand-border text-white hover:bg-brand-surface',
  ghost:     'bg-transparent text-brand-muted hover:text-white border border-transparent',
  danger:    'bg-red-500 hover:bg-red-600 text-white',
};

const sizes: Record<Size, string> = {
  sm: 'h-10 px-4 text-sm',
  md: 'h-12 px-6 text-base',
  lg: 'h-14 px-8 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      whileTap={isDisabled ? undefined : { scale: 0.94 }}
      transition={{ duration: 0.1 }}
      disabled={isDisabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-medium',
        'transition-all duration-150',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'select-none touch-manipulation',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...(props as object)}
    >
      {loading ? (
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : children}
    </motion.button>
  );
}
