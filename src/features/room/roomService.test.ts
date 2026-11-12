import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A room ending is four writes that must not be four requests: the whole point
// of end_round() is that the client stops sequencing them. These tests pin the
// client half of that contract — what it asks for, and what it must NOT do
// once the server has answered.

const rpc = vi.fn();
const from = vi.fn();
const endAliasRound = vi.fn();
const activateAliasRound = vi.fn();

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));
vi.mock('@/features/game/roundLifecycle', () => ({
  activateAliasRound: (...args: unknown[]) => activateAliasRound(...args),
  endAliasRound: (...args: unknown[]) => endAliasRound(...args),
}));
vi.mock('@/shared/lib/telegram', () => ({ getRawInitData: () => 'signed-test-init-data' }));
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
  endAliasRound.mockReset();
  endAliasRound.mockResolvedValue({ outcome: 'already_ended', next_round_id: null });
  activateAliasRound.mockReset();
  activateAliasRound.mockResolvedValue({ outcome: 'already_active', card_count: 5 });
  from.mockReset();
  from.mockImplementation(() => builder());
  vi.useFakeTimers();
  roomService = await import('./roomService');
});

afterEach(() => { vi.useRealTimers(); });

describe('endRound', () => {
  it('asks the server, and asks it only once', async () => {
    endAliasRound.mockResolvedValue({ outcome: 'already_ended', next_round_id: null });

    const outcome = await roomService.endRound('round-1', room);

    expect(outcome).toBe('already_ended');
    expect(endAliasRound).toHaveBeenCalledTimes(1);
    expect(endAliasRound).toHaveBeenCalledWith('round-1', 'signed-test-init-data');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not touch a table when the round was already claimed', async () => {
    endAliasRound.mockResolvedValue({ outcome: 'already_ended', next_round_id: null });

    await roomService.endRound('round-1', room);

    // The losing caller used to read round_cards and upsert scores anyway.
    expect(from).not.toHaveBeenCalled();
  });

  it('leaves scoring and statistics to the transaction when the game ends', async () => {
    endAliasRound.mockResolvedValue({ outcome: 'game_end', next_round_id: null });

    const outcome = await roomService.endRound('round-1', room);

    expect(outcome).toBe('game_end');
    // No rooms UPDATE, and — the part that used to be lost when a player
    // closed Telegram on the results screen — no award_room_stats follow-up.
    expect(from).not.toHaveBeenCalled();
    expect(endAliasRound).toHaveBeenCalledTimes(1);
  });

  it('activates the round the server named, after the summary pause', async () => {
    endAliasRound.mockResolvedValue({ outcome: 'next_round', next_round_id: 'round-2' });
    activateAliasRound.mockResolvedValue({ outcome: 'activated', card_count: 5 });

    const pending = roomService.endRound('round-1', room);

    // Nothing may happen while the summary is on screen.
    await vi.advanceTimersByTimeAsync(roomService.SUMMARY_PAUSE_MS - 1);
    expect(activateAliasRound).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    await pending;

    expect(activateAliasRound).toHaveBeenCalledTimes(1);
    expect(activateAliasRound).toHaveBeenCalledWith('round-2', 'signed-test-init-data');
    expect(from).not.toHaveBeenCalled();
  });

  it('does not fall back to client-side writes when the Rust API fails', async () => {
    endAliasRound.mockRejectedValue(new Error('backend unavailable'));
    await expect(roomService.endRound('round-1', room)).rejects.toThrow('backend unavailable');
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ─── The room's deck ────────────────────────────────────────────────
//
// The deal used to pass `{ categories }` and nothing else, so every dimension
// the picker offers — leagues, squads, a fame floor — stopped at the training
// screen. These pin the seam: what the room stores is what the round deals.

describe('activateRound', () => {
  it('delegates card selection, room claiming and activation to the Rust API', async () => {
    activateAliasRound.mockResolvedValue({ outcome: 'activated', card_count: 5 });

    await expect(roomService.activateRound('round-1', room)).resolves.toBe(true);

    expect(activateAliasRound).toHaveBeenCalledWith('round-1', 'signed-test-init-data');
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not deal or write again when the round is already active', async () => {
    activateAliasRound.mockResolvedValue({ outcome: 'already_active', card_count: 5 });

    await expect(roomService.activateRound('round-1', room)).resolves.toBe(false);

    expect(activateAliasRound).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it('does not fall back to client-side dealing when the Rust API fails', async () => {
    activateAliasRound.mockRejectedValue(new Error('backend unavailable'));

    await expect(roomService.activateRound('round-1', room)).rejects.toThrow('backend unavailable');
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('setRoomDeckFilter', () => {
  it('goes through the RPC — `rooms` is writable by anyone', async () => {
    rpc.mockResolvedValue({ data: { categories: null, deck: {} }, error: null });

    await roomService.setRoomDeckFilter('room-1', { categories: ['player'], lang: 'ru' });

    expect(from).not.toHaveBeenCalled();
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('set_room_deck_filter');
    expect(args.p_room_id).toBe('room-1');
    // lang is one phone's setting; a room has several. Stripped before it
    // reaches the row, not merely ignored when read back.
    expect(args.p_filter).toEqual({ categories: ['player'] });
  });

  it('throws rather than reporting a write that did not happen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'only the host' } });
    await expect(roomService.setRoomDeckFilter('room-1', {})).rejects.toThrow('only the host');
  });
});
