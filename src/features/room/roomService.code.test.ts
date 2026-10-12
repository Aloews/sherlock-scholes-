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

const validRoom = {
  id: 'room-123',
  code: 'AB12CD',
  mode: 'team',
  status: 'waiting',
  host_id: 100,
  settings: { categories: null, cards_per_round: 5, total_rounds: 3, round_seconds: 60 },
};

function queryBuilder(table: string, result: unknown, calls: Array<{ table: string; method: string; args: unknown[] }>) {
  const methods: Record<string, unknown> = {};
  return new Proxy(methods, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: String(property), args });
        return methods;
      };
    },
  });
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
    mocks.from.mockImplementation((table: string) => queryBuilder(table, { data: validRoom, error: null }, calls));
    await joinRoom('ab12cd', 200);
    expect(calls).toContainEqual({ table: 'rooms', method: 'eq', args: ['code', 'AB12CD'] });
    expect(calls).toContainEqual({ table: 'rooms', method: 'eq', args: ['status', 'waiting'] });
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
});
