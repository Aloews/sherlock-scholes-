import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/** Accent-filled text. In the master design the fill is the brand gradient; in
 * classic `--accent-gradient` is a flat colour, so the same clip renders plain
 * orange — one component, both designs, no branching. See index.css. */
export function GradientText({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={clsx('ds-accent-text', className)}>{children}</span>;
}
