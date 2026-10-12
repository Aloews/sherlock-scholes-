import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  pickCardIds: vi.fn(),
}));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock('@/features/game/cardRandomizer', () => ({
  pickCardIds: mocks.pickCardIds,
}));
vi.mock('@/shared/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/shared/lib/telegram', () => ({ getRawInitData: () => 'signed-init-data' }));

import { createRoom, joinRoom } from './roomService';
import type { DeckFilter } from '@/shared/types/deck';

const validRoom = {
  id: 'room-123',
  code: 'AB12CD',
  mode: 'team',
  status: 'waiting',
  host_id: 100,
  settings: { categories: null, cards_per_round: 5, total_rounds: 3, round_seconds: 60 },
};

function queryBuilder(table: string, calls: Array<{ table: string; method: string; args: unknown[] }>, room = validRoom) {
  let proxy: Record<string | symbol, unknown>;
  proxy = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const isStatusCheck = table === 'rooms' && calls.some((call) =>
            call.table === 'rooms' && call.method === 'select' && call.args[0] === 'status'
          );
          const result = table === 'rooms'
            ? { data: isStatusCheck ? { status: 'waiting' } : room, error: null }
            : { data: null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        };
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: String(property), args });
        return proxy;
      };
    },
  });
  return proxy;
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  mocks.pickCardIds.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('room code contract', () => {
  it('refuses to join with a one-character code before querying the database', async () => {
    await expect(joinRoom('A', 200)).rejects.toThrow('INVALID_ROOM_CODE');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('normalizes and passes the full six-character code into the room lookup', async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    mocks.from.mockImplementation((table: string) => queryBuilder(table, calls));
    await joinRoom('ab12cd', 200);
    expect(calls).toContainEqual({ table: 'rooms', method: 'eq', args: ['code', 'AB12CD'] });
    expect(calls).toContainEqual({ table: 'rooms', method: 'eq', args: ['status', 'waiting'] });
  });

  it('rejects a room row whose stored code is shorter than six characters', async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    mocks.from.mockImplementation((table: string) => queryBuilder(table, calls, { ...validRoom, code: 'A' }));

    await expect(joinRoom('AB12CD', 200)).rejects.toThrow('INVALID_ROOM_CODE_RETURNED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a 1v1 join response that does not contain the full code', async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    mocks.from.mockImplementation((table: string) => queryBuilder(table, calls, { ...validRoom, mode: '1v1' }));
    mocks.rpc.mockResolvedValue({ data: { ...validRoom, mode: '1v1', code: 'A' }, error: null });

    await expect(joinRoom('AB12CD', 200)).rejects.toThrow('INVALID_ROOM_CODE_RETURNED');
  });

  it('does not return a created room unless the generated code has six valid characters', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...validRoom, code: 'A' },
      error: null,
    });
    await expect(createRoom(100)).rejects.toThrow('INVALID_ROOM_CODE_RETURNED');
    expect(mocks.rpc).toHaveBeenCalledWith('create_team_room', expect.objectContaining({ p_host_id: 100 }));
  });

  it('returns the full generated code from room creation', async () => {
    mocks.rpc.mockResolvedValue({ data: validRoom, error: null });
    const room = await createRoom(100);
    expect(room.code).toBe('AB12CD');
    expect(room.code).toHaveLength(6);
  });

  it('preserves an AI-selected category and exact card IDs in team-room settings', async () => {
    const deck: DeckFilter = { categories: ['coach'], card_ids: ['coach-1', 'coach-2', 'coach-3'] };
    mocks.rpc.mockResolvedValue({ data: validRoom, error: null });

    await createRoom(100, { categories: ['coach'], deck });

    expect(mocks.rpc).toHaveBeenCalledWith('create_team_room', {
      p_host_id: 100,
      p_settings: expect.objectContaining({ categories: ['coach'], deck }),
    });
  });

  it('preserves an AI-selected deck in 1v1 without changing the six-character room code', async () => {
    const deck: DeckFilter = { categories: ['stadium'], card_ids: ['stadium-1', 'stadium-2', 'stadium-3'] };
    mocks.rpc.mockResolvedValue({ data: { ...validRoom, mode: '1v1' }, error: null });

    const room = await createRoom(100, { total_rounds: 5, categories: ['stadium'], deck }, '1v1');

    expect(room.code).toBe('AB12CD');
    expect(room.code).toHaveLength(6);
    expect(mocks.rpc).toHaveBeenCalledWith('create_1v1_room', {
      p_host_id: 100,
      p_settings: expect.objectContaining({
        categories: ['stadium'],
        deck,
        total_rounds: 5,
        cards_per_round: 100,
      }),
    });
  });

  it('validates codes returned by the 1v1 room creator', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...validRoom, mode: '1v1', code: 'A' }, error: null });
    await expect(createRoom(100, {}, '1v1')).rejects.toThrow('INVALID_ROOM_CODE_RETURNED');
    expect(mocks.rpc).toHaveBeenCalledWith('create_1v1_room', expect.objectContaining({ p_host_id: 100 }));
  });

  it('joins a 1v1 room only with the full normalized code', async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    mocks.from.mockImplementation((table: string) => queryBuilder(table, calls, { ...validRoom, mode: '1v1' }));
    mocks.rpc.mockResolvedValue({ data: { ...validRoom, mode: '1v1' }, error: null });
    await joinRoom('ab12cd', 200);
    expect(calls).toContainEqual({ table: 'rooms', method: 'eq', args: ['code', 'AB12CD'] });
    expect(mocks.rpc).toHaveBeenCalledWith('join_1v1_room', { p_room_id: 'room-123', p_player_id: 200 });
  });
});
