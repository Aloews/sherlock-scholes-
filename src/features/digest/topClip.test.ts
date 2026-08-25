import { describe, it, expect, vi, beforeEach } from 'vitest';

// digestApi импортирует клиент Supabase, а тот падает на старте без
// VITE_-переменных. Мокается модуль целиком: проверяется ВЫБОР, а не сеть.
vi.mock('./digestApi', () => ({
  fetchRecentGoals: vi.fn(),
  fetchGoals: vi.fn(),
}));

import { fetchRecentGoals, fetchGoals } from './digestApi';
import { fetchTopClip } from './topClip';

const weekend = (over: Partial<Record<string, unknown>> = {}) => ({
  video_id: 'w1', title: 'Bruno scored from a corner', channel: 'Premier League',
  published_at: '2026-08-09T12:00:00Z', thumb_url: 'https://i/1.jpg',
  views: 245031, likes: 900, is_goal: true,
  window_start: '2026-08-08T00:00:00Z', window_end: '2026-08-10T00:00:00Z',
  ...over,
});

const daily = (over: Partial<Record<string, unknown>> = {}) => ({
  video_id: 'd1', title: 'Today at the training ground', channel: 'LALIGA',
  published_at: '2026-08-11T09:00:00Z', thumb_url: 'https://i/2.jpg',
  ...over,
});

const mockRecent = vi.mocked(fetchRecentGoals);
const mockDaily = vi.mocked(fetchGoals);

beforeEach(() => {
  mockRecent.mockReset();
  mockDaily.mockReset();
});

describe('fetchTopClip', () => {
  it('берёт первую строку сервера и не пересортировывает её', () => {
    // Порядок задан сервером: сначала голы, внутри по просмотрам. Если бы
    // клиент выбирал сам, «лучшее» на главной и «лучшее» в дайджесте стали бы
    // разными вещами, и разошлись бы молча.
    mockRecent.mockResolvedValue([
      weekend({ video_id: 'first', views: 100 }),
      weekend({ video_id: 'more_views', views: 999999 }),
    ] as never);

    return expect(fetchTopClip()).resolves.toMatchObject({ video_id: 'first' });
  });

  it('просит у сервера ровно один ролик', async () => {
    mockRecent.mockResolvedValue([weekend()] as never);
    await fetchTopClip();
    expect(mockRecent).toHaveBeenCalledWith(1);
    // И не ходит за суточными, когда выходные ответили.
    expect(mockDaily).not.toHaveBeenCalled();
  });

  it('называет голом только то, что сервер признал голом', async () => {
    mockRecent.mockResolvedValue([weekend({ is_goal: true })] as never);
    expect((await fetchTopClip())?.kind).toBe('goal');
  });

  it('не обещает гол, когда самый смотренный ролик — не гол', async () => {
    // ЭТО НЕ УМОЗРИТЕЛЬНЫЙ СЛУЧАЙ. На прошлых выходных самым смотренным
    // роликом был СЕЙВ с 1.3 млн просмотров — по просмотрам он первый, и
    // подписать его «лучший гол» значило бы соврать на главном экране.
    mockRecent.mockResolvedValue([
      weekend({ title: 'One Of The Best Saves EVER!?', is_goal: false, views: 1_299_959 }),
    ] as never);
    expect((await fetchTopClip())?.kind).toBe('moment');
  });

  it('откатывается на свежее видео, когда выходных ещё нет', async () => {
    // Понедельник до первого прогона конвейера и первые дни жизни базы.
    // Пустой блок на главной читался бы как поломка.
    mockRecent.mockResolvedValue([] as never);
    mockDaily.mockResolvedValue([daily()] as never);

    const top = await fetchTopClip();
    expect(top).toMatchObject({ video_id: 'd1', kind: 'fresh' });
    expect(mockDaily).toHaveBeenCalledWith(1);
  });

  it('у свежего видео не показывает просмотров', async () => {
    // Они есть, но раздел суточных отвечает на «что нового», и число значило
    // бы «сколько успел набрать за час» — то есть почти ноль.
    mockRecent.mockResolvedValue([] as never);
    mockDaily.mockResolvedValue([daily()] as never);
    expect((await fetchTopClip())?.views).toBeNull();
  });

  it('отдаёт null, когда нет ничего вообще', async () => {
    mockRecent.mockResolvedValue([] as never);
    mockDaily.mockResolvedValue([] as never);
    expect(await fetchTopClip()).toBeNull();
  });

  it('переносит просмотры и обложку как есть', async () => {
    mockRecent.mockResolvedValue([weekend()] as never);
    expect(await fetchTopClip()).toEqual({
      video_id: 'w1',
      title: 'Bruno scored from a corner',
      channel: 'Premier League',
      thumb_url: 'https://i/1.jpg',
      views: 245031,
      kind: 'goal',
    });
  });
});
