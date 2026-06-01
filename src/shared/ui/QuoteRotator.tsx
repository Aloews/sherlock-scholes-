import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { QUOTES } from '@/shared/data/quotes';

const ROTATE_MS = 20_000;

function randomIndex(exclude: number): number {
  if (QUOTES.length <= 1) return 0;
  let next = exclude;
  while (next === exclude) {
    next = Math.floor(Math.random() * QUOTES.length);
  }
  return next;
}

interface QuoteRotatorProps {
  className?: string;
}

export function QuoteRotator({ className }: QuoteRotatorProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => randomIndex(prev));
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const current = QUOTES[index];

  return (
    <div className={clsx('text-center px-4', className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <p className="text-brand-muted/90 text-[13px] italic leading-snug">
            «{current.quote}»
          </p>
          <p className="text-brand-muted text-xs mt-1">
            — {current.author}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
