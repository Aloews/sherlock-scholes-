import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/shared/types/database';
import { CATEGORY_EMOJI, CATEGORY_LABEL_RU } from '@/shared/types/database';

interface PlayerCardProps {
  card: Card;
  mode: 'explainer' | 'hidden';
  className?: string;
}

export function PlayerCard({ card, mode, className }: PlayerCardProps) {
  const { t } = useTranslation();

  if (mode === 'hidden') {
    return (
      <div
        className={clsx(
          'rounded-3xl bg-zinc-900 border border-zinc-800 p-8',
          'flex flex-col items-center justify-center gap-4 min-h-[260px]',
          className,
        )}
      >
        <div className="text-6xl">⚽</div>
        <p className="text-zinc-500 text-lg font-medium">{t('card.guessing')}</p>
        <p className="text-zinc-600 text-sm">{t('card.shout_answer')}</p>
      </div>
    );
  }

  const emoji = CATEGORY_EMOJI[card.category] ?? '⚽';
  const label = card.category_ru ?? CATEGORY_LABEL_RU[card.category] ?? card.category;

  return (
    <div
      className={clsx(
        'rounded-3xl bg-zinc-900 border border-zinc-800 overflow-hidden animate-slide-up',
        className,
      )}
    >
      {/* Category header */}
      <div className="bg-emerald-500/10 border-b border-zinc-800 px-6 py-3 flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <span className="text-sm text-emerald-400 font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>

      {/* Card name */}
      <div className="px-6 py-6">
        <p className="text-3xl font-black text-white leading-tight">{card.name}</p>
      </div>

      {/* Forbidden words */}
      {card.forbidden_words.length > 0 && (
        <div className="px-6 pb-6">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            {t('card.forbidden_words')}
          </p>
          <div className="flex flex-wrap gap-2">
            {card.forbidden_words.map((word) => (
              <span
                key={word}
                className="text-sm bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl px-3 py-1 font-semibold line-through"
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
