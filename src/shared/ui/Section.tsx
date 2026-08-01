import type { ReactNode } from 'react';

/** A titled block: heading, optional one-line explanation, content. */
export function Section({
  title, hint, children,
}: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-white text-lg font-bold leading-tight">{title}</h2>
        {hint && <p className="text-brand-muted text-xs leading-snug">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
