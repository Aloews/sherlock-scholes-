// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayerCard } from './PlayerCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru' },
  }),
}));
vi.mock('@/shared/lib/tier', () => ({
  tierCardStyle: () => undefined,
  tierFrameStyle: () => undefined,
}));
vi.mock('@/shared/ui/CategoryIcon', () => ({
  CategoryIcon: () => null,
  CATEGORY_COLOR: { player: '#FF6300' },
  CATEGORY_FALLBACK_COLOR: '#7A8499',
}));
vi.mock('@/shared/ui/CardWatermark', () => ({
  CardWatermark: () => null,
}));
vi.mock('@/shared/design/useDesign', () => ({
  useDesign: () => 'classic',
}));

describe('PlayerCard rarity', () => {
  it('visibly labels a legendary player instead of rendering it like a common card', () => {
    render(
      <PlayerCard
        mode="explainer"
        card={{
          name: 'Хвича Кварацхелия',
          name_en: 'Khvicha Kvaratskhelia',
          category: 'player',
          category_ru: 'Игроки',
          photo_url: null,
          tier: 'legendary',
        }}
      />,
    );
    expect(screen.getByTestId('card-rarity').textContent).toBe('Легендарная');
  });

  it('does not add a rarity badge to common cards', () => {
    render(
      <PlayerCard
        mode="explainer"
        card={{
          name: 'Тестовый игрок',
          name_en: 'Test Player',
          category: 'player',
          category_ru: 'Игроки',
          photo_url: null,
          tier: 'common',
        }}
      />,
    );
    expect(screen.queryByTestId('card-rarity')).toBeNull();
  });
});
