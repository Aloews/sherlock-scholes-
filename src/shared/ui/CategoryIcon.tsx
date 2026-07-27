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
import type { CardCategory } from '@/shared/types/database';

// Category → colour/icon. These are DATA colours (they encode which kind of
// card you are looking at), so they are identical in both design systems —
// see docs/DESIGN_SYSTEM.md. Shared by PlayerCard and the Collection screen.

export const CATEGORY_COLOR: Record<CardCategory, string> = {
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

export const CATEGORY_FALLBACK_COLOR = '#7A8499';

export function CategoryIcon({ category, color, size = 13 }: {
  category: CardCategory;
  color: string;
  size?: number;
}) {
  const props = { size, color, stroke: 1.75 };
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
