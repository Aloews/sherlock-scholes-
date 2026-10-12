// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  initData: vi.fn(() => 'signed-init-data' as string | null),
  squads: [] as Array<{ key: string; name: string; players: number; asOf: string | null }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'ru' },
  }),
}));
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: mocks.initData,
  hapticImpact: vi.fn(),
}));
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock('@/features/game/squads', () => ({
  fetchSquads: () => Promise.resolve(mocks.squads),
  formatSquadAsOf: () => '',
}));

import { RoomDeckPanel } from './RoomDeckPanel';

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.initData.mockReturnValue('signed-init-data');
  mocks.invoke.mockResolvedValue({
    data: {
      title: 'Тренеры',
      message: 'Готово',
      cards: [
        { id: 'coach-1', name: 'Coach One', category: 'coach' },
        { id: 'coach-2', name: 'Coach Two', category: 'coach' },
        { id: 'coach-3', name: 'Coach Three', category: 'coach' },
      ],
    },
    error: null,
  });
});
afterEach(() => cleanup());

describe('AI deck intent in the room lobby', () => {
  it('sends the host request to the intent agent and saves its exact cards and category', async () => {
    const onChange = vi.fn();
    render(<RoomDeckPanel filter={{ categories: null }} count={12} isHost failed={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /lobby\.deck_title/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос для колоды' }), {
      target: { value: 'Тренеры сборных' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      categories: ['coach'],
      card_ids: ['coach-1', 'coach-2', 'coach-3'],
      leagues: null,
      clubs: null,
      countries: null,
      continents: null,
      tags: null,
    })));
    expect(mocks.invoke).toHaveBeenCalledWith('smart-deck-builder', {
      body: expect.objectContaining({
        prompt: 'Тренеры сборных',
        language: 'ru',
        init_data: 'signed-init-data',
        current_card_ids: [],
      }),
    });
    expect((await screen.findByRole('status')).textContent).toContain('Готово');
  });

  it('does not update the room deck when the agent returns fewer than three valid cards', async () => {
    mocks.invoke.mockResolvedValue({ data: { cards: [{ id: 'coach-1', category: 'coach' }] }, error: null });
    const onChange = vi.fn();
    render(<RoomDeckPanel filter={{ categories: null }} count={12} isHost failed={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /lobby\.deck_title/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос для колоды' }), {
      target: { value: 'Один тренер' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Не найдено достаточно карточек');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('requires Telegram initData before calling the agent', async () => {
    mocks.initData.mockReturnValue(null);
    const onChange = vi.fn();
    render(<RoomDeckPanel filter={{ categories: null }} count={12} isHost failed={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /lobby\.deck_title/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос для колоды' }), {
      target: { value: 'Легенды Барселоны' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Открой приложение через Telegram');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
