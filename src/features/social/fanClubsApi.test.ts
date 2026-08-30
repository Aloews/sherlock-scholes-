import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { fetchFanClubs, fetchJoinableClubs, joinFanClub, leaveFanClub } =
  await import('./fanClubsApi');

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchFanClubs', () => {
  it('без подписи отдаёт пустой список как УСПЕХ', async () => {
    const res = await fetchFanClubs('');
    expect(res.status).toBe('ok');
    expect(rpc).not.toHaveBeenCalled();
  });

  // «Ни в одном клубе» и «не загрузилось» — разные вещи, и экран говорит о них
  // по-разному. Свести их в пустой список значило бы показать «вы ни в одном
  // клубе» там, где на деле сломался запрос.
  it('отказ сервера — состояние ОШИБКИ, а не пустой список', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'invalid init data' } });
    expect((await fetchFanClubs('bad')).status).toBe('error');
  });
});

describe('fetchJoinableClubs', () => {
  it('пустой запрос уходит как null, а не как пустая строка', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchJoinableClubs('signed', '');
    // `''` в ilike '%%' совпало бы со всем и выглядело бы как поиск, который
    // ничего не фильтрует; сервер ждёт null, чтобы отдать список целиком.
    expect(rpc).toHaveBeenCalledWith('joinable_clubs', {
      p_init_data: 'signed', p_query: null,
    });
  });

  it('непустой запрос передаётся как есть', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchJoinableClubs('signed', 'Arsen');
    expect(rpc).toHaveBeenCalledWith('joinable_clubs', {
      p_init_data: 'signed', p_query: 'Arsen',
    });
  });
});

describe('joinFanClub / leaveFanClub', () => {
  it('успех возвращает true', async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await joinFanClub('signed', 'Arsenal')).toBe(true);
    expect(await leaveFanClub('signed', 'Arsenal')).toBe(true);
  });

  // ⚠️ Сервер отказывает на выдуманном клубе кодом 22023 — проверено на боевой
  // базе: is_real_club('Клуб имени меня') = false. Клиент обязан вернуть false,
  // а не бросить: экран покажет отказ, а не «не получилось загрузить».
  it('отказ на неизвестном клубе возвращает false, а не бросает', async () => {
    rpc.mockResolvedValue({ error: { code: '22023', message: 'unknown club' } });
    await expect(joinFanClub('signed', 'Клуб имени меня')).resolves.toBe(false);
  });

  it('без подписи не ходит на сервер', async () => {
    expect(await joinFanClub('', 'Arsenal')).toBe(false);
    expect(await leaveFanClub('', 'Arsenal')).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
