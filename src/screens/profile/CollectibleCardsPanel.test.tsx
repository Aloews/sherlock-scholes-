// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  initData: vi.fn(() => 'signed-init-data' as string | null),
}));

vi.mock('@/shared/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/shared/lib/telegram', () => ({ getRawInitData: mocks.initData }));
vi.mock('@/shared/lib/cardName', () => ({
  cardDisplayName: (card: { name: string; name_en: string | null }, lang: string) =>
    lang.startsWith('en') && card.name_en ? card.name_en : card.name,
}));
vi.mock('@/shared/ui/PlayerPhoto', () => ({
  PlayerPhoto: () => <div data-testid="player-photo" />,
}));
vi.mock('@/shared/design/useDesign', () => ({ useDesign: () => 'master' }));
vi.mock('@/shared/lib/tier', () => ({ tierCardStyle: () => ({}) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'ru' },
  }),
}));

import { CollectibleCardsPanel } from './CollectibleCardsPanel';

const owned = [{
  card_id: 'card-messi',
  name: 'Лионель Месси',
  name_en: 'Lionel Messi',
  category: 'player',
  category_ru: 'Футболист',
  photo_url: 'https://example.test/messi.jpg',
  tier: 'legendary',
  correct_guesses: 100,
  acquired_at: '2026-10-12T12:00:00Z',
}];

const progress = [{
  card_id: 'card-haaland',
  name: 'Эрлинг Холанд',
  name_en: 'Erling Haaland',
  category: 'player',
  category_ru: 'Футболист',
  photo_url: null,
  tier: 'rare',
  correct_guesses: 73,
}];

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.initData.mockReturnValue('signed-init-data');
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({
    data: name === 'my_card_collectibles' ? owned : progress,
    error: null,
  }));
});

afterEach(() => cleanup());

describe('CollectibleCardsPanel', () => {
  it('loads owned cards and persistent progress through authenticated RPCs', async () => {
    render(<CollectibleCardsPanel playerId={42} />);

    expect(await screen.findByText('Лионель Месси')).toBeTruthy();
    expect(screen.getByText('Эрлинг Холанд')).toBeTruthy();
    expect(screen.getByText('profile.collectibles_count · 1')).toBeTruthy();
    expect(screen.getByText('73/100')).toBeTruthy();
    expect(screen.getByText('profile.collectibles_progress_remaining:{"count":27}')).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('my_card_collectibles', { p_init_data: 'signed-init-data' });
    expect(mocks.rpc).toHaveBeenCalledWith('my_card_collectible_progress', { p_init_data: 'signed-init-data' });
  });

  it('shows an empty collection when the server returns no owned cards', async () => {
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    render(<CollectibleCardsPanel playerId={42} />);

    expect(await screen.findByText('profile.collectibles_empty')).toBeTruthy();
    expect(screen.queryByText('Лионель Месси')).toBeNull();
  });

  it('does not query inventory without Telegram initData and reports the unavailable state', async () => {
    mocks.initData.mockReturnValue(null);
    render(<CollectibleCardsPanel playerId={42} />);

    expect(await screen.findByText('profile.collectibles_error')).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not show stale profile data after the player signs out', async () => {
    const { rerender } = render(<CollectibleCardsPanel playerId={42} />);
    expect(await screen.findByText('Лионель Месси')).toBeTruthy();

    rerender(<CollectibleCardsPanel playerId={null} />);
    await waitFor(() => expect(screen.queryByText('Лионель Месси')).toBeNull());
    expect(screen.getByText('profile.collectibles_empty')).toBeTruthy();
  });
});
