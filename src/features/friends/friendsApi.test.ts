import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const {
  fetchFriends, fetchSuggestions, addFriend, removeFriend, displayName,
} = await import('./friendsApi');

// What matters here is what happens when the server says no. A friends list
// that throws takes the profile down with it, and a write that reports success
// it did not get would leave the screen claiming a friendship the database
// never stored.

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const ok = (data: unknown) => rpc.mockResolvedValue({ data, error: null });
const fail = () => rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });

describe('fetchFriends', () => {
  it('passes the player id and returns the rows', async () => {
    ok([{ player_id: 1, first_name: 'Alex', xp: 100 }]);
    await expect(fetchFriends(42)).resolves.toEqual({
      status: 'ok',
      data: [{ player_id: 1, first_name: 'Alex', xp: 100 }],
    });
    expect(rpc).toHaveBeenCalledWith('friends_with_rating', { p_player_id: 42 });
  });

  it('reports a failure AS a failure, not as an empty list', async () => {
    // Раньше здесь ожидался пустой массив, и это было верно для той формы:
    // отказ и отсутствие друзей выглядели одинаково НАМЕРЕННО. Проверка
    // изменена вместе с контрактом, потому что менялось именно это свойство —
    // у нового игрока друзей правда нет, и «пока никого» никого не удивляет,
    // так что отказ под той же надписью не опознавался вовсе.
    fail();
    await expect(fetchFriends(42)).resolves.toEqual({ status: 'error', code: '42501' });
  });

  it('пустой ответ остаётся успехом', async () => {
    // Ноль друзей — законный ответ, а не поломка. Это половина различия, ради
    // которого всё и затевалось.
    ok(null);
    await expect(fetchFriends(42)).resolves.toEqual({ status: 'ok', data: [] });
  });
});

describe('fetchSuggestions', () => {
  it('sends the limit it was given', async () => {
    ok([]);
    await fetchSuggestions(42, 5);
    expect(rpc).toHaveBeenCalledWith('friend_suggestions', { p_player_id: 42, p_limit: 5 });
  });

  it('defaults the limit rather than leaving it to the server', async () => {
    ok([]);
    await fetchSuggestions(42);
    expect(rpc).toHaveBeenCalledWith('friend_suggestions', { p_player_id: 42, p_limit: 10 });
  });

  it('returns an empty list when the call fails', async () => {
    fail();
    await expect(fetchSuggestions(42)).resolves.toEqual([]);
  });
});

describe('addFriend / removeFriend', () => {
  // The write path sends initData, never a player id: the server derives the
  // caller from the signature, so one player cannot edit another's list.
  it('sends the signed initData and the target, and nothing else', async () => {
    ok(true);
    await addFriend('init-data-blob', 7);
    expect(rpc).toHaveBeenCalledWith('add_friend', {
      p_init_data: 'init-data-blob', p_friend_id: 7,
    });
  });

  it('does not even ask when there is no initData to prove who is asking', async () => {
    await expect(addFriend('', 7)).resolves.toBe(false);
    await expect(removeFriend('', 7)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports failure when the server refuses', async () => {
    fail();
    await expect(addFriend('init', 7)).resolves.toBe(false);
  });

  // A false return is the server declining, not an error — it must not read
  // as success just because nothing threw.
  it('treats a false answer as a refusal', async () => {
    ok(false);
    await expect(addFriend('init', 7)).resolves.toBe(false);
    ok(true);
    await expect(removeFriend('init', 7)).resolves.toBe(true);
  });
});

describe('displayName', () => {
  it('joins the halves and drops the empty one', () => {
    expect(displayName({ first_name: 'Alex', last_name: 'Smith' })).toBe('Alex Smith');
    expect(displayName({ first_name: 'Alex', last_name: null })).toBe('Alex');
    expect(displayName({ first_name: 'Alex', last_name: '' })).toBe('Alex');
  });
});
