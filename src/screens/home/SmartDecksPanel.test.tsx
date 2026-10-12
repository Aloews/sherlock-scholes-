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
vi.mock('@/shared/lib/telegram', () => ({ openLink: vi.fn() }));
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
  for (const method of ['select', 'gte', 'order', 'limit', 'eq', 'not']) {
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
  mocks.invoke.mockImplementation((name: string) => Promise.resolve({
    data: name === 'smart-deck-builder'
      ? { title: 'AI selected legends', description: 'A playable set of verified players.', card_ids: players.slice(0, 8).map((player) => player.card_id) }
      : { editorials: [], mode: 'deterministic' },
    error: null,
  }));
});
afterEach(() => cleanup());

describe('SmartDecksPanel AI deck builder', () => {
  it('sends the user prompt to AI, previews verified player cards, and starts with selected IDs', async () => {
    const onStart = vi.fn();
    render(<SmartDecksPanel onStart={onStart} />);

    fireEvent.click(await screen.findByRole('button', { name: /Ask AI to build a deck/i }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const prompt = screen.getByLabelText(/Your request/i);
    fireEvent.change(prompt, { target: { value: 'Build a deck of famous World Cup winners' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate deck with AI/i }));

    expect(await screen.findByText('AI selected legends')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith('smart-deck-builder', {
      body: { prompt: 'Build a deck of famous World Cup winners', language: 'en' },
    });
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(8));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Play this deck/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const [filter, presetId] = onStart.mock.calls[0];
    expect(presetId).toBe('smart-ai-custom');
    expect(filter.card_ids).toHaveLength(7);
    expect(filter.card_ids).not.toContain('player-0');
    expect(filter.categories).toEqual(['player']);
  });

  it('does not call AI for a blank request', async () => {
    const onStart = vi.fn();
    render(<SmartDecksPanel onStart={onStart} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask AI to build a deck/i }));
    const generate = screen.getByRole('button', { name: /Generate deck with AI/i });
    expect(generate).toHaveProperty('disabled', true);
    expect(mocks.invoke).not.toHaveBeenCalledWith('smart-deck-builder', expect.anything());
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows an error when AI cannot return a valid deck', async () => {
    mocks.invoke.mockImplementation((name: string) => Promise.resolve({
      data: name === 'smart-deck-builder' ? { card_ids: ['invalid'] } : { editorials: [], mode: 'deterministic' },
      error: null,
    }));
    render(<SmartDecksPanel onStart={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask AI to build a deck/i }));
    fireEvent.change(screen.getByLabelText(/Your request/i), { target: { value: 'Build a deck around the Premier League' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate deck with AI/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
