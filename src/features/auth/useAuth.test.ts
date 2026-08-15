// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

// ВХОД В ПРИЛОЖЕНИЕ, И ДО СИХ ПОР НИ ОДНОГО ТЕСТА. Отказ здесь не роняет
// экран — он оставляет приложение в состоянии «ещё грузим» навсегда, и это
// выглядит как медленный интернет, а не как поломка.

const single = vi.fn();
const upsert = vi.fn((..._a: unknown[]) => ({ select: () => ({ single }) }));
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }) },
}));

const getTelegramUser = vi.fn();
const initTelegram = vi.fn();
vi.mock('@/shared/lib/telegram', () => ({
  getTelegramUser: () => getTelegramUser(),
  initTelegram: () => initTelegram(),
}));

import { useAuth } from './useAuth';
import { useAuthStore } from '@/shared/store/authStore';

const TG = { id: 42, first_name: 'Иван', last_name: 'Петров', username: 'ivan', photo_url: 'https://p/1.jpg' };
const ROW = { id: 42, first_name: 'Иван', last_name: 'Петров', username: 'ivan', avatar_url: 'https://p/1.jpg' };

beforeEach(async () => {
  // СНАЧАЛА ДАЁМ ОСЕСТЬ ПРЕДЫДУЩЕМУ ТЕСТУ. authenticate() асинхронна, и её
  // setInitialized(true) может прилететь уже после того, как тест кончился —
  // то есть ПОСЛЕ сброса состояния. Тогда следующий тест видит initialized
  // = true, эффект не запускается вовсе, и падение выглядит как «upsert не
  // вызван», хотя дело в чужом хвосте.
  await new Promise((r) => setTimeout(r, 0));
  useAuthStore.setState({ player: null, initialized: false });
  single.mockReset(); upsert.mockClear();
  getTelegramUser.mockReset(); initTelegram.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  // РАЗМОНТИРОВАТЬ ОБЯЗАТЕЛЬНО. Хук подписан на стор, и пока он смонтирован,
  // он живёт и между тестами: сброс состояния в beforeEach перезапускал его
  // эффект, и следующий тест видел лишний вызов getTelegramUser, которого сам
  // не делал. Симптом — «вход случился повторно» — указывал на код, а причина
  // была в тесте.
  cleanup();
  vi.restoreAllMocks();
});

describe('useAuth', () => {
  it('вне Telegram завершает вход без игрока, а не зависает', async () => {
    // Приложение открывают и из браузера. Оставить initialized=false значит
    // показывать заставку вечно.
    getTelegramUser.mockReturnValue(null);
    useAuthStore.setState({ player: null, initialized: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.player).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('сохраняет игрока из ответа БАЗЫ, а не из Telegram', async () => {
    // Существенно: на экране должно оказаться то, что в базе. Подставить сюда
    // объект из Telegram значило бы показать данные, которых в базе нет.
    getTelegramUser.mockReturnValue(TG);
    single.mockResolvedValue({ data: { ...ROW, first_name: 'ИЗ БАЗЫ' }, error: null });

    useAuthStore.setState({ player: null, initialized: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.player?.first_name).toBe('ИЗ БАЗЫ');
  });

  it('пишет id, выданный Telegram, и разрешает конфликт по нему', async () => {
    // id — это личность игрока. Он приходит из Telegram и не выбирается
    // клиентом; onConflict по нему делает повторный вход обновлением, а не
    // вторым игроком.
    getTelegramUser.mockReturnValue(TG);
    single.mockResolvedValue({ data: ROW, error: null });

    useAuthStore.setState({ player: null, initialized: false });
    renderHook(() => useAuth());
    await waitFor(() => expect(upsert).toHaveBeenCalled());

    const [row, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, { onConflict: string }];
    expect(row.id).toBe(42);
    expect(opts.onConflict).toBe('id');
  });

  it('необязательные поля Telegram пишутся как null, а не как undefined', async () => {
    // undefined в PostgREST — это «не трогать колонку», и снятая аватарка
    // осталась бы на месте навсегда. null означает «пусто», как и задумано.
    getTelegramUser.mockReturnValue({ id: 7, first_name: 'Аноним' });
    single.mockResolvedValue({ data: { id: 7, first_name: 'Аноним' }, error: null });

    useAuthStore.setState({ player: null, initialized: false });
    renderHook(() => useAuth());
    await waitFor(() => expect(upsert).toHaveBeenCalled());

    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.username).toBeNull();
    expect(row.last_name).toBeNull();
    expect(row.avatar_url).toBeNull();
  });

  it('на отказе базы всё равно завершает вход', async () => {
    // Иначе приложение остаётся в «ещё грузим» навсегда: экран не покажет
    // ошибки, потому что ошибки в состоянии нет — есть незавершённая загрузка.
    getTelegramUser.mockReturnValue(TG);
    single.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });

    useAuthStore.setState({ player: null, initialized: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.initialized).toBe(true));
  });

  it('не входит повторно, когда вход уже состоялся', async () => {
    // Эффект зависит от initialized; без этого свойства каждый рендер писал бы
    // в players заново.
    useAuthStore.setState({ player: ROW as never, initialized: true });
    renderHook(() => useAuth());
    await new Promise((r) => setTimeout(r, 20));
    expect(upsert).not.toHaveBeenCalled();
    expect(getTelegramUser).not.toHaveBeenCalled();
  });
});
