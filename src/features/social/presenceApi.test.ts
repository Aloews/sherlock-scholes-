import { describe, it, expect, vi, beforeEach } from 'vitest';

// Присутствие — необязательная часть экрана, и главное здесь одно: оно не
// должно ни падать, ни врать. Формулу «кто онлайн» считает Postgres, и
// проверять её тут значило бы проверять свой же стенд.

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { touchPresence, fetchOnlinePlayers } = await import('./presenceApi');

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('touchPresence', () => {
  it('без подписи НЕ ходит на сервер', async () => {
    await touchPresence('');
    expect(rpc).not.toHaveBeenCalled();
  });

  // ⚠️ САМОЕ ВАЖНОЕ ЗДЕСЬ. Удар сердца идёт раз в минуту; если бы он слал
  // hidden = false, он молча возвращал бы спрятавшегося человека в список
  // через минуту после того, как тот спрятался.
  it('обычный удар НЕ трогает видимость (шлёт null)', async () => {
    rpc.mockResolvedValue({ error: null });
    await touchPresence('signed');
    expect(rpc).toHaveBeenCalledWith('touch_presence', {
      p_init_data: 'signed',
      p_hidden: null,
    });
  });

  it('переключение видимости передаёт её явно', async () => {
    rpc.mockResolvedValue({ error: null });
    await touchPresence('signed', true);
    expect(rpc).toHaveBeenCalledWith('touch_presence', {
      p_init_data: 'signed',
      p_hidden: true,
    });
    await touchPresence('signed', false);
    expect(rpc).toHaveBeenLastCalledWith('touch_presence', {
      p_init_data: 'signed',
      p_hidden: false,
    });
  });

  it('отказ сервера не бросает', async () => {
    rpc.mockResolvedValue({ error: { code: '28000', message: 'invalid init data' } });
    await expect(touchPresence('bad')).resolves.toBeUndefined();
  });
});

describe('fetchOnlinePlayers', () => {
  it('без подписи отдаёт пустой список как УСПЕХ, а не ошибку', async () => {
    const res = await fetchOnlinePlayers('');
    expect(res.status).toBe('ok');
    expect(res.status === 'ok' && res.data).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('отказ сервера — это состояние ОШИБКИ, а не пустой список', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'invalid init data' } });
    const res = await fetchOnlinePlayers('bad');
    // ⚠️ Отличать «никого нет» от «не загрузилось» — ровно то, ради чего в
    // проекте заведён LoadState: пустой список на поломке показал бы «сейчас
    // никого» там, где на деле сломался запрос.
    expect(res.status).toBe('error');
  });

  it('успех отдаёт строки как есть', async () => {
    rpc.mockResolvedValue({
      data: [{ player_id: 7, first_name: 'Ann', last_name: null, avatar_url: null,
               seen_at: '2026-08-26T05:00:00Z', is_friend: true }],
      error: null,
    });
    const res = await fetchOnlinePlayers('signed');
    expect(res.status === 'ok' && res.data[0].player_id).toBe(7);
  });
});
