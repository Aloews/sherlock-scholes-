// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  countCards: vi.fn(),
  fetchSquads: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));
vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
  },
}));
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: () => 'test-init-data',
  hapticImpact: vi.fn(),
}));
vi.mock('@/shared/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/features/game/cardRandomizer', () => ({
  countCards: (...args: unknown[]) => mocks.countCards(...args),
}));
vi.mock('@/features/game/squads', () => ({
  fetchSquads: (...args: unknown[]) => mocks.fetchSquads(...args),
  formatSquadAsOf: () => '',
}));

import { DeckPickerScreen } from './DeckPickerScreen';

describe('DeckPickerScreen AI deck prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: [] });
    mocks.countCards.mockResolvedValue(12);
    mocks.fetchSquads.mockResolvedValue([]);
    mocks.invoke.mockResolvedValue({
      data: { cards: [
        { id: 'player-1', category: 'player' },
        { id: 'player-2', category: 'player' },
        { id: 'club-1', category: 'club' },
      ] },
      error: null,
    });
  });
  afterEach(() => cleanup());

  it('builds a deck from a natural-language prompt', async () => {
    const onStart = vi.fn();
    render(<DeckPickerScreen isPro={false} gamesPlayed={0} onClose={vi.fn()} onNeedPro={vi.fn()} onStart={onStart} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос для ИИ-колоды' }), {
      target: { value: 'Легенды Реала 2000-х' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Собрать колоду' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith({
      categories: ['player', 'club'],
      card_ids: ['player-1', 'player-2', 'club-1'],
    }, 'ai-prompt'));
    expect(mocks.invoke).toHaveBeenCalledWith('smart-deck-builder', {
      body: expect.objectContaining({
        prompt: 'Легенды Реала 2000-х',
        language: 'ru',
        init_data: 'test-init-data',
        current_card_ids: [],
        target_card_count: 20,
      }),
    });
  });
});
