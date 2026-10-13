// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock('@/shared/lib/telegram', () => ({ openLink: vi.fn(), getRawInitData: () => 'signed-init-data' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));

import { SmartDecksPanel } from './SmartDecksPanel';

const players = Array.from({ length: 10 }, (_, index) => ({
  card_id: `player-${index}`,
  name: `Player ${index}`,
  name_en: `Player ${index}`,
  photo_url: null,
  matches: 3,
  goals: index,
  assists: 1,
  club: 'Test Club',
  club_key: 'test club',
}));

const cards = players.map((player) => ({
  id: player.card_id,
  name: player.name,
  name_en: player.name_en,
  photo_url: null,
  category: 'player',
}));

function queryBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'gte', 'lte', 'order', 'limit', 'eq', 'not']) {
    builder[method] = (...args: unknown[]) => {
      filters[method] = args;
      return builder;
    };
  }
  builder.in = (_column: string, ids: string[]) => {
    filters.ids = ids;
    return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
    let data: unknown[] = [];
    if (table === 'cards') {
      data = filters.not ? [] : filters.ids
        ? cards.filter((card) => (filters.ids as string[]).includes(card.id))
        : cards;
    }
    if (table === 'player_match_stats') {
      const ids = (filters.ids as string[] | undefined) ?? [];
      data = ids.map((card_id) => ({ card_id, home_team: 'Test Club', away_team: 'Opponent', disputed: false }));
    }
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };
  return builder;
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.from.mockImplementation((table: string) => queryBuilder(table));
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({
    data: name === 'player_ratings' ? players : [],
    error: null,
  }));
  mocks.invoke.mockResolvedValue({ data: { editorials: [], mode: 'deterministic' }, error: null });
});

afterEach(() => cleanup());

describe('SmartDecksPanel deck builder', () => {
  it('opens a dialog, allows card selection, and starts with the exact selected IDs', async () => {
    const onStart = vi.fn();
    render(<SmartDecksPanel onStart={onStart} />);

    fireEvent.click(await screen.findByRole('button', { name: /Build deck/i }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(10));

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Build deck & play/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const [filter, presetId] = onStart.mock.calls[0];
    expect(presetId).toBe('smart-current-form');
    expect(filter.card_ids).toHaveLength(9);
    expect(filter.card_ids).not.toContain('player-0');
  });

  it('does not start an empty deck', async () => {
    const onStart = vi.fn();
    render(<SmartDecksPanel onStart={onStart} />);
    fireEvent.click(await screen.findByRole('button', { name: /Build deck/i }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(10));
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /Build deck & play/i })).toHaveProperty('disabled', true);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('sends a natural-language prompt to the AI and plays the exact returned card IDs', async () => {
    const onStart = vi.fn();
    mocks.invoke.mockImplementation((name: string) => Promise.resolve(name === 'smart-deck-builder'
      ? { data: { title: 'AI selected deck', message: 'Built from your request.', cards: cards.slice(1, 8) }, error: null }
      : { data: { editorials: [], mode: 'deterministic' }, error: null }));
    render(<SmartDecksPanel onStart={onStart} />);

    fireEvent.click(await screen.findByRole('button', { name: /Build deck/i }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(10));
    fireEvent.change(screen.getByRole('textbox', { name: /AI deck request/i }), {
      target: { value: 'Build a deck with the players I asked for' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Build with AI/i }));

    expect(await screen.findByText('Built from your request.')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith('smart-deck-builder', expect.objectContaining({
      body: expect.objectContaining({
        prompt: 'Build a deck with the players I asked for',
        language: 'en',
        init_data: 'signed-init-data',
      }),
    }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(7));
    fireEvent.click(screen.getByRole('button', { name: /Build deck & play/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].card_ids).toEqual(cards.slice(1, 8).map((card) => card.id));
  });
});
