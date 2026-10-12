import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args), from: (...args: unknown[]) => state.from(...args) },
}));
vi.mock('@/features/game/cardRandomizer', () => ({ pickCardIds: vi.fn(async () => ['card-1']) }));
vi.mock('@/shared/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/shared/lib/telegram', () => ({ getRawInitData: () => 'signed-init-data' }));

function builder(table: string, result: unknown) {
  const proxy: Record<string | symbol, unknown> = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return (...args: unknown[]) => {
        state.queries.push({ table, method: String(property), args });
        return proxy;
      };
    },
  });
  return proxy;
}

let service: typeof import('./roomService');
const createdRoom = { id: 'room-1', code: 'AB12CD', host_id: 7, status: 'waiting', mode: 'team', settings: {} };

beforeEach(async () => {
  vi.resetModules();
  state.rpc.mockReset();
  state.from.mockReset();
  state.queries.length = 0;
  state.from.mockImplementation((table: string) => {
    const calls = state.queries.filter((q) => q.table === table).length;
    if (table === 'rooms') return builder(table, calls === 0
      ? { data: { ...createdRoom }, error: null }
      : { data: { status: 'waiting' }, error: null });
    return builder(table, { data: null, error: null });
  });
  service = await import('./roomService');
});

afterEach(() => vi.clearAllMocks());

describe('room creation and joining contract', () => {
  it('creates a room through the atomic RPC and refuses a malformed generated code', async () => {
    state.rpc.mockResolvedValue({ data: createdRoom, error: null });
    const room = await service.createRoom(7);
    expect(state.rpc).toHaveBeenCalledWith('create_team_room', expect.objectContaining({
      p_host_id: 7,
      p_settings: expect.objectContaining({ cards_per_round: 5 }),
    }));
    expect(room.code).toBe('AB12CD');
    expect(room.code).toHaveLength(6);
  });

  it('does not expose a newly created room when the server returns a one-character code', async () => {
    state.rpc.mockResolvedValue({ data: { ...createdRoom, code: 'A' }, error: null });
    await expect(service.createRoom(7)).rejects.toThrow('INVALID_CREATED_ROOM_CODE');
  });

  it.each(['A', 'ABC', 'ABCDEFG', 'ABC-12', ''])('rejects invalid join code %j before querying rooms', async (code) => {
    await expect(service.joinRoom(code, 8)).rejects.toThrow('INVALID_ROOM_CODE');
    expect(state.from).not.toHaveBeenCalled();
  });

  it('normalizes a complete six-character code and uses it to find a waiting room', async () => {
    const result = await service.joinRoom('ab12cd', 8);
    expect(result.id).toBe('room-1');
    expect(state.queries).toContainEqual({ table: 'rooms', method: 'eq', args: ['code', 'AB12CD'] });
    expect(state.queries).toContainEqual({ table: 'rooms', method: 'eq', args: ['status', 'waiting'] });
    expect(state.queries).toContainEqual({ table: 'room_players', method: 'insert', args: [{ room_id: 'room-1', player_id: 8 }] });
  });
});
