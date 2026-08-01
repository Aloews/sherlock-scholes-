import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/shared/types/database';
import { cardDisplayName } from '@/shared/lib/cardName';
import { tierCardStyle, tierFrameStyle } from '@/shared/lib/tier';
import { photoFitClass } from '@/shared/lib/photoFit';
import { useDesign } from '@/shared/design/useDesign';
import {
  CategoryIcon, CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR,
} from '@/shared/ui/CategoryIcon';

/** Everything the card actually renders. Declared as a Pick rather than the
 * full `Card` so callers that fetched only the display columns — the
 * Collection screen — can reuse this component without inventing the rest. */
export type PlayerCardData = Pick<
  Card,
  'name' | 'name_en' | 'category' | 'category_ru' | 'photo_url' | 'tier' | 'card_translations'
>;

interface PlayerCardProps {
  card: PlayerCardData;
  mode: 'explainer' | 'hidden';
  className?: string;
}

export function PlayerCard({ card, mode, className }: PlayerCardProps) {
  const { t, i18n } = useTranslation();

  if (mode === 'hidden') {
    return (
      <div
        className={clsx(
          'rounded-2xl bg-brand-surface border border-brand-border p-8',
          'flex flex-col items-center justify-center gap-4 min-h-[260px]',
          className,
        )}
      >
        <div className="w-16 h-16 rounded-full bg-brand-border flex items-center justify-center">
          <span className="text-3xl">⚽</span>
        </div>
        <div className="text-center">
          <p className="text-brand-muted text-lg font-medium">{t('card.guessing')}</p>
          <p className="text-brand-muted/50 text-sm mt-1">{t('card.shout_answer')}</p>
        </div>
      </div>
    );
  }

  const design   = useDesign();
  const catColor = CATEGORY_COLOR[card.category] ?? CATEGORY_FALLBACK_COLOR;
  // Localized category label; the DB's Russian category_ru wins only on ru
  // (it can carry admin-customised labels).
  const label    = i18n.language.startsWith('ru') && card.category_ru
    ? card.category_ru
    : t(`category.${card.category}`);
  // Translation -> name_en -> name, per the interface language (same rule
  // as the quick-game summary).
  const name     = cardDisplayName(card, i18n.language);
  const master   = design === 'master';

  // Master: the prototype's composition — gradient rarity frame around a
  // gradient-filled card, centred category badge, big Playfair name, category
  // in caps beneath. Classic keeps the original left-aligned header + name.
  if (master) {
    const frame = tierFrameStyle(card.tier, design);
    return (
      <div className={clsx('rounded-[20px]', className)} style={frame}>
        <div
          className="relative rounded-[18.5px] overflow-hidden"
          style={{ background: 'linear-gradient(180deg, #161d30, #0c0f1c)' }}
        >
          <div className="h-1" style={{ background: 'var(--accent-gradient)' }} />
          {card.photo_url && (
            // Smaller and edge-masked than the classic card's watermark: the
            // master composition is shorter and centred, so the classic
            // sizing bled a legible, off-centre face across the icon badge
            // and name instead of reading as a background texture.
            <div
              className="absolute -right-3 -bottom-4 w-24 h-24 pointer-events-none select-none"
              style={{
                maskImage: 'radial-gradient(circle at 60% 40%, black 0%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(circle at 60% 40%, black 0%, transparent 75%)',
              }}
              aria-hidden
            >
              <img
                src={card.photo_url}
                alt=""
                className={clsx('w-full h-full opacity-[0.13]', photoFitClass(card.category))}
              />
            </div>
          )}
          <div className="relative px-5 pt-6 pb-7 flex flex-col items-center text-center">
            <span
              className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
              style={{ backgroundColor: 'rgb(var(--brand-accent) / 0.08)', border: `1px solid ${catColor}66` }}
            >
              <CategoryIcon category={card.category} color={catColor} size={20} />
            </span>
            <p className="ds-display text-[26px] font-bold text-white leading-[1.15]">{name}</p>
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.14em] mt-2"
              style={{ color: catColor }}
            >
              {label}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'ds-panel relative rounded-2xl bg-brand-surface border border-brand-border overflow-hidden',
        className,
      )}
      // Rarity tier: subtle coloured frame + glow (common/unknown → none).
      // The design id is passed explicitly so the frame restyles the moment
      // the player switches design systems.
      style={tierCardStyle(card.tier, design)}
    >
      {/* Thin category colour strip */}
      <div className="h-1" style={{ backgroundColor: catColor }} />

      {/* Watermark (variant 5 of the design review): the card's own wiki
          photo ghosted in the corner behind the name — a visual hint for the
          explainer that costs zero space. Photo only, preloaded a card ahead
          (useGame/useTraining) so it appears together with the card; cards
          without a photo show nothing. */}
      {card.photo_url && (
        <div className="absolute -right-4 -bottom-6 w-36 h-36 pointer-events-none select-none" aria-hidden>
          <img
            src={card.photo_url}
            alt=""
            className={clsx('w-full h-full opacity-[0.13]', photoFitClass(card.category))}
          />
        </div>
      )}

      {/* Category label */}
      <div className="relative px-5 pt-3 pb-1 flex items-center gap-1.5">
        <CategoryIcon category={card.category} color={catColor} />
        <span className="text-[11px] text-brand-muted uppercase tracking-widest font-medium">
          {label}
        </span>
      </div>

      {/* Card name — centred, medium weight, display face (Playfair in the
          master design, Inter in classic). */}
      <div className="relative px-5 pt-4 pb-8 text-center">
        <p className="ds-display text-3xl font-medium text-white leading-snug">{name}</p>
      </div>
    </div>
  );
}
