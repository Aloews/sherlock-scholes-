// Category → colour + outline icon. Shared by the in-game PlayerCard and the
// Collection screen (grid cells + filter pills) so the category→icon map lives
// in exactly one place.

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

interface CategoryIconProps {
  category: CardCategory;
  color: string;
  /** 13 matches PlayerCard's category line; the Collection grid asks for 16. */
  size?: number;
}

export function CategoryIcon({ category, color, size = 13 }: CategoryIconProps) {
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
