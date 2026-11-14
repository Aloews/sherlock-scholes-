// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  initData: vi.fn(() => 'signed-init-data' as string | null),
  squads: [] as Array<{ club_key: string; club: string; players: number; card_id: string | null; fetched_at: string | null; league: string | null }>,
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
  supabase: {
    functions: { invoke: mocks.invoke },
    rpc: () => Promise.resolve({ data: mocks.squads, error: null }),
  },
}));

import { RoomDeckPanel } from './RoomDeckPanel';

beforeEach(() => {
  mocks.squads = [];
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
  it('filters lobby squad options by every selected league and removes only invalid clubs', async () => {
    mocks.squads = [
      { club_key: 'arsenal', club: 'Arsenal', players: 23, card_id: null, fetched_at: null, league: 'Premier League' },
      { club_key: 'chelsea', club: 'Chelsea', players: 24, card_id: null, fetched_at: null, league: 'Premier League' },
      { club_key: 'barcelona', club: 'Barcelona', players: 25, card_id: null, fetched_at: null, league: 'La Liga' },
    ];
    const onChange = vi.fn();
    const view = render(
      <RoomDeckPanel
        filter={{ categories: ['player'], clubs: ['arsenal'] }}
        count={12} isHost failed={false} onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /lobby\.deck_title/ }));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));

    const [leagueSelect, squadSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(Array.from(squadSelect.options).map((option) => option.value))
      .toEqual(['', 'arsenal', 'chelsea', 'barcelona']);

    fireEvent.change(leagueSelect, { target: { value: 'La Liga' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      leagues: ['La Liga'],
      clubs: null,
    }));

    view.rerender(
      <RoomDeckPanel
        filter={{ categories: ['player'], leagues: ['Premier League', 'La Liga'], clubs: ['arsenal'] }}
        count={12} isHost failed={false} onChange={onChange}
      />,
    );
    await waitFor(() => {
      const [, allLeaguesSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(Array.from(allLeaguesSelect.options).map((option) => option.value))
        .toEqual(['', 'arsenal', 'chelsea', 'barcelona']);
    });
  });

  it('preserves a selected club when it belongs to the newly selected league', async () => {
    mocks.squads = [
      { club_key: 'arsenal', club: 'Arsenal', players: 23, card_id: null, fetched_at: null, league: 'Premier League' },
      { club_key: 'barcelona', club: 'Barcelona', players: 25, card_id: null, fetched_at: null, league: 'La Liga' },
    ];
    const onChange = vi.fn();
    render(
      <RoomDeckPanel
        filter={{ categories: ['player'], clubs: ['arsenal'] }}
        count={12} isHost failed={false} onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /lobby\.deck_title/ }));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    const [leagueSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(leagueSelect, { target: { value: 'Premier League' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      leagues: ['Premier League'],
      clubs: ['arsenal'],
    }));
  });

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
