import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  IconUser,
  IconShield,
  IconBuildingStadium,
  IconTag,
  IconTarget,
  IconFlag,
  IconClipboard,
  IconMicrophone,
  IconSwords,
  IconTrophy,
  IconHourglass,
} from '@tabler/icons-react';
import type { Card, CardCategory } from '@/shared/types/database';
import { cardDisplayName } from '@/shared/lib/cardName';
import { tierCardStyle } from '@/shared/lib/tier';

interface PlayerCardProps {
  card: Card;
  mode: 'explainer' | 'hidden';
  className?: string;
}

const CATEGORY_COLOR: Record<CardCategory, string> = {
  player:        '#FF6300',
  club:          '#4A9EFF',
  club_nickname: '#4A9EFF',
  stadium:       '#00C97D',
  term:          '#B47AFF',
  position:      '#B47AFF',
  referee:       '#FFD24A',
  coach:         '#FFD24A',
  commentator:   '#7A8499',
  woman:         '#FF6BA8',
  derby:         '#F43F5E',
  trophy:        '#FFD24A',
  era:           '#22D3EE',
};

function CategoryIcon({ category, color }: { category: CardCategory; color: string }) {
  const props = { size: 13, color, stroke: 1.75 };
  if (category === 'club' || category === 'club_nickname') return <IconShield      {...props} />;
  if (category === 'stadium')                              return <IconBuildingStadium {...props} />;
  if (category === 'term')                                 return <IconTag          {...props} />;
  if (category === 'position')                             return <IconTarget       {...props} />;
  if (category === 'referee')                              return <IconFlag         {...props} />;
  if (category === 'coach')                                return <IconClipboard    {...props} />;
  if (category === 'commentator')                          return <IconMicrophone   {...props} />;
  if (category === 'derby')                                return <IconSwords       {...props} />;
  if (category === 'trophy')                               return <IconTrophy       {...props} />;
  if (category === 'era')                                  return <IconHourglass    {...props} />;
  return <IconUser {...props} />;  // player, woman, default
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

  const catColor = CATEGORY_COLOR[card.category] ?? '#7A8499';
  // Localized category label; the DB's Russian category_ru wins only on ru
  // (it can carry admin-customised labels).
  const label    = i18n.language.startsWith('ru') && card.category_ru
    ? card.category_ru
    : t(`category.${card.category}`);
  // Translation -> name_en -> name, per the interface language (same rule
  // as the quick-game summary).
  const name     = cardDisplayName(card, i18n.language);

  return (
    <div
      className={clsx(
        'rounded-2xl bg-brand-surface border border-brand-border overflow-hidden',
        className,
      )}
      // Rarity tier: subtle coloured frame + glow (common/unknown → none).
      style={tierCardStyle(card.tier)}
    >
      {/* Thin category colour strip */}
      <div className="h-1" style={{ backgroundColor: catColor }} />

      {/* Category label */}
      <div className="px-5 pt-3 pb-1 flex items-center gap-1.5">
        <CategoryIcon category={card.category} color={catColor} />
        <span className="text-[11px] text-brand-muted uppercase tracking-widest font-medium">
          {label}
        </span>
      </div>

      {/* Card name — centred, medium weight */}
      <div className="px-5 pt-4 pb-8 text-center">
        <p className="text-3xl font-medium text-white leading-snug">{name}</p>
      </div>
    </div>
  );
}
