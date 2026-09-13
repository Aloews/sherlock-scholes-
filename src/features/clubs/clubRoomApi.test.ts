import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { fetchClubRoom, postClubMessage, deleteClubMessage } =
  await import('./clubRoomApi');

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/**
 * ⚠️ ПРИЧИНА ОТКАЗА РАЗБИРАЕТСЯ ПО КОДУ, А НЕ ПО ТЕКСТУ. Текст приходит с
 * сервера на английском и меняется при любой правке функции; код — часть
 * договора. Разница видна человеку: «подождите секунду» и «слишком длинно»
 * лечатся по-разному, а одна общая надпись «не отправилось» не лечится никак.
 */
describe('postClubMessage: почему не отправилось', () => {
  it('успех — это null, а не объект', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    expect(await postClubMessage('signed', 'real-madrid', 'привет')).toBeNull();
  });

  it('53400 — слишком часто', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '53400', message: 'too fast' } });
    expect(await postClubMessage('signed', 'real-madrid', 'ещё')).toBe('too_fast');
  });

  it('22023 на длинном тексте — это длина, а не чужой клуб', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'bad body' } });
    const long = 'а'.repeat(501);
    expect(await postClubMessage('signed', 'real-madrid', long)).toBe('too_long');
  });

  it('22023 на коротком — это неизвестный клуб', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'unknown club' } });
    expect(await postClubMessage('signed', 'нет-такого', 'привет')).toBe('unknown_club');
  });

  it('прочее — общий отказ', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'boom' } });
    expect(await postClubMessage('signed', 'real-madrid', 'привет')).toBe('failed');
  });

  // ⚠️ БЕЗ ПОДПИСИ ВЫЗОВА НЕ ДЕЛАЕМ ВОВСЕ. Сервер откажет, но отказ стоит
  // круговой поездки и выглядит как поломка, а не как «вы не в Telegram».
  it('без подписи не ходит на сервер', async () => {
    expect(await postClubMessage('', 'real-madrid', 'привет')).toBe('failed');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('новость уходит вместе с репликой', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await postClubMessage('signed', 'real-madrid', 'вот это да',
                          { url: 'https://x/y', title: 'Заголовок' });
    expect(rpc).toHaveBeenCalledWith('post_club_message', {
      p_init_data: 'signed', p_club: 'real-madrid', p_body: 'вот это да',
      p_news_url: 'https://x/y', p_news_title: 'Заголовок',
    });
  });

  it('без новости уходят null, а не undefined', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await postClubMessage('signed', 'real-madrid', 'просто так');
    // undefined PostgREST пропустит мимо, и параметр возьмёт DEFAULT — здесь
    // это совпало бы, но полагаться на совпадение нельзя.
    expect(rpc).toHaveBeenCalledWith('post_club_message', {
      p_init_data: 'signed', p_club: 'real-madrid', p_body: 'просто так',
      p_news_url: null, p_news_title: null,
    });
  });
});

describe('fetchClubRoom', () => {
  it('без подписи — пустая комната как УСПЕХ, без запроса', async () => {
    const res = await fetchClubRoom('', 'real-madrid');
    expect(res.status).toBe('ok');
    expect(rpc).not.toHaveBeenCalled();
  });

  // «В комнате тихо» и «не загрузилось» — разные вещи, и первое экран
  // показывает надписью, а второе показывать надписью нельзя.
  it('отказ сервера — состояние ОШИБКИ, а не пустая комната', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'invalid init data' } });
    expect((await fetchClubRoom('bad', 'real-madrid')).status).toBe('error');
  });
});

describe('deleteClubMessage', () => {
  it('true только когда сервер сказал true', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await deleteClubMessage('signed', 7)).toBe(true);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: чужое сообщение сервер не удалит и вернёт
  // false. Экран обязан НЕ показать удаление — иначе строка исчезнет с глаз и
  // вернётся при следующей загрузке, и это выглядит как поломка.
  it('чужое не удаляется: false остаётся false', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await deleteClubMessage('signed', 7)).toBe(false);
  });

  it('ошибка — тоже false', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'nope' } });
    expect(await deleteClubMessage('signed', 7)).toBe(false);
  });
});
