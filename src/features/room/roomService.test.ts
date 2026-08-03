import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A room ending is four writes that must not be four requests: the whole point
// of end_round() is that the client stops sequencing them. These tests pin the
// client half of that contract — what it asks for, and what it must NOT do
// once the server has answered.

const rpc = vi.fn();
const from = vi.fn();

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));
vi.mock('@/features/game/cardRandomizer', () => ({
  pickCardIds: vi.fn(async () => ['card-1']),
}));
vi.mock('@/shared/lib/analytics', () => ({ trackEvent: vi.fn() }));

// Every PostgREST builder call returns the builder; awaiting it yields the
// canned result. Enough to observe which tables were touched with what.
function builder(result: unknown = { data: [{ id: 'room-1' }], error: null }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const proxy: Record<string | symbol, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      }
      if (prop === '__calls') return calls;
      return (...args: unknown[]) => { calls.push({ method: String(prop), args }); return proxy; };
    },
  }) as Record<string | symbol, unknown>;
  return proxy;
}

const room = {
  id: 'room-1',
  mode: 'team',
  settings: { cards_per_round: 5, categories: null },
} as unknown as import('@/shared/types/database').Room;

let roomService: typeof import('./roomService');

beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => builder());
  vi.useFakeTimers();
  roomService = await import('./roomService');
});

afterEach(() => { vi.useRealTimers(); });

describe('endRound', () => {
  it('asks the server, and asks it only once', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'already_ended', next_round_id: null }, error: null });

    const outcome = await roomService.endRound('round-1', room);

    expect(outcome).toBe('already_ended');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('end_round', { p_round_id: 'round-1' });
  });

  it('does not touch a table when the round was already claimed', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'already_ended', next_round_id: null }, error: null });

    await roomService.endRound('round-1', room);

    // The losing caller used to read round_cards and upsert scores anyway.
    expect(from).not.toHaveBeenCalled();
  });

  it('leaves scoring and statistics to the transaction when the game ends', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'game_end', next_round_id: null }, error: null });

    const outcome = await roomService.endRound('round-1', room);

    expect(outcome).toBe('game_end');
    // No rooms UPDATE, and — the part that used to be lost when a player
    // closed Telegram on the results screen — no award_room_stats follow-up.
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('deals the round the server named, after the summary pause', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'next_round', next_round_id: 'round-2' }, error: null });

    const pending = roomService.endRound('round-1', room);

    // Nothing may happen while the summary is on screen.
    await vi.advanceTimersByTimeAsync(roomService.SUMMARY_PAUSE_MS - 1);
    expect(from).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    await pending;

    const claim = (from.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }).__calls;
    expect(from).toHaveBeenCalledWith('rooms');
    expect(claim[0].args[0]).toMatchObject({ current_round_id: 'round-2' });
  });

  it('falls back to the old sequence when the RPC is not on the database yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    from.mockImplementation((table: string) => (
      table === 'rounds'
        ? builder({ data: [{ team_id: 'team-1', round_number: 1 }], error: null })
        : builder({ data: [], error: null })
    ));

    const pending = roomService.endRound('round-1', room);
    await vi.advanceTimersByTimeAsync(roomService.SUMMARY_PAUSE_MS + 1);
    await pending;

    expect(from).toHaveBeenCalledWith('rounds');
    expect(from).toHaveBeenCalledWith('scores');
  });
});
