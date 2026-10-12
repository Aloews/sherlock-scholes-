// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  initData: vi.fn((): string | null => 'signed-init-data'),
  success: vi.fn(),
  error: vi.fn(),
  impact: vi.fn(),
}));

vi.mock('@/shared/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: mocks.initData,
  hapticSuccess: mocks.success,
  hapticError: mocks.error,
  hapticImpact: mocks.impact,
}));
vi.mock('@/shared/lib/cardName', () => ({
  cardDisplayName: (card: { name: string; name_en: string | null }) => card.name,
}));
vi.mock('@/shared/ui/PlayerPhoto', () => ({ PlayerPhoto: () => <div data-testid="player-photo" /> }));
vi.mock('@/shared/design/useDesign', () => ({ useDesign: () => 'master' }));
vi.mock('@/shared/lib/tier', () => ({ tierCardStyle: () => ({}) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));

import { CollectibleTradingPanel } from './CollectibleTradingPanel';

const ownCard = {
  collectible_id: 'asset-messi',
  card_id: 'card-messi',
  name: 'Лионель Месси',
  name_en: 'Lionel Messi',
  category: 'player',
  category_ru: 'Футболист',
  photo_url: null,
  tier: 'legendary',
};
const friendCard = {
  card_id: 'card-haaland',
  name: 'Эрлинг Холанд',
  name_en: 'Erling Haaland',
  category: 'player',
  category_ru: 'Футболист',
  photo_url: null,
  tier: 'rare',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.initData.mockReturnValue('signed-init-data');
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'friends_with_rating') return Promise.resolve({
      data: [{ player_id: 2, first_name: 'Друг', last_name: null, username: null }],
      error: null,
    });
    if (name === 'my_card_tradeable_collectibles') return Promise.resolve({ data: [ownCard], error: null });
    if (name === 'my_player_card_trades') return Promise.resolve({ data: [], error: null });
    if (name === 'friend_collectible_inventory') return Promise.resolve({ data: [friendCard], error: null });
    if (name === 'create_player_card_trade') return Promise.resolve({ data: 'trade-1', error: null });
    return Promise.resolve({ data: true, error: null });
  });
});

afterEach(() => cleanup());

describe('CollectibleTradingPanel', () => {
  it('loads friend inventories and submits a one-for-one proposal through the server RPC', async () => {
    render(<CollectibleTradingPanel playerId={1} />);

    const friendSelect = await screen.findByLabelText('profile.trade_friend');
    fireEvent.change(friendSelect, { target: { value: '2' } });
    await screen.findByRole('option', { name: 'Эрлинг Холанд' });

    fireEvent.change(screen.getByLabelText('profile.trade_offer'), { target: { value: 'asset-messi' } });
    fireEvent.change(screen.getByLabelText('profile.trade_request'), { target: { value: 'card-haaland' } });
    fireEvent.click(screen.getByRole('button', { name: 'profile.trade_propose' }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('create_player_card_trade', {
        p_init_data: 'signed-init-data',
        p_to_player_id: 2,
        p_offered_collectible_id: 'asset-messi',
        p_requested_card_id: 'card-haaland',
      });
    });
    expect(await screen.findByText('profile.trade_proposed')).toBeTruthy();
  });

  it('does not load or expose trade data when Telegram initData is absent', async () => {
    mocks.initData.mockReturnValue(null);
    render(<CollectibleTradingPanel playerId={1} />);

    expect(await screen.findByText('profile.trade_load_error')).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
