import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Клиент Supabase падает на старте без VITE-переменных, поэтому модуль
// мокается целиком. Проверяется не сеть, а РЕШЕНИЯ обёрток: что считать
// ответом, что — отказом, и что уходит на сервер.
const rpc = vi.fn();
const invoke = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { getUserStatus, createProInvoice, bumpGames } from './proApi';

// ЭТО ДЕНЬГИ И ПРАВА ДОСТУПА, и до сих пор здесь не было ни одного теста.
// Ошибка тут не роняет приложение — она тихо выдаёт Pro тому, кто не платил,
// или отказывает тому, кто заплатил. Ни то ни другое не видно на экране.

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

const okRpc = (data: unknown) => rpc.mockResolvedValue({ data, error: null });
const errRpc = (code: string) => rpc.mockResolvedValue({ data: null, error: { code, message: 'nope' } });

const STATUS = { telegram_id: 42, is_pro: true, pro_since: '2026-01-01', games_played: 7 };

describe('getUserStatus', () => {
  it('отдаёт статус и передаёт initData НЕТРОНУТЫМ', () => {
    // Подпись считается по всей строке целиком: обрезать, перекодировать или
    // разобрать её на части значит сломать HMAC и получить отказ на верных
    // данных.
    okRpc(STATUS);
    return getUserStatus('query_id=A&user=%7B%22id%22%3A42%7D&hash=abc').then((s) => {
      expect(s).toEqual(STATUS);
      expect(rpc).toHaveBeenCalledWith('get_user_status', {
        p_init_data: 'query_id=A&user=%7B%22id%22%3A42%7D&hash=abc',
      });
    });
  });

  it('на отказе возвращает null, а не «не Pro»', async () => {
    // Разница существенная: null означает «неизвестно», и вызывающий сам
    // решает считать это отсутствием Pro. Вернуть здесь готовый объект с
    // is_pro: false значило бы утверждать факт, которого мы не знаем.
    errRpc('28000');
    expect(await getUserStatus('bad')).toBeNull();
  });

  it('пустой ответ — тоже null', async () => {
    okRpc(null);
    expect(await getUserStatus('x')).toBeNull();
  });

  it('НЕ выдаёт Pro по собственному решению', async () => {
    // Единственный источник истины — база. Клиент не имеет права дорисовать
    // is_pro, и этот тест держит именно это свойство.
    okRpc({ ...STATUS, is_pro: false });
    expect((await getUserStatus('x'))?.is_pro).toBe(false);
  });
});

describe('createProInvoice', () => {
  it('не ходит в сеть без initData', async () => {
    // Пустая строка снаружи Telegram — обычное дело. Запрос с ней гарантированно
    // получит отказ, то есть потратит время и запишет ошибку ни за что.
    expect(await createProInvoice('')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('возвращает ссылку и шлёт подписанные данные', async () => {
    invoke.mockResolvedValue({ data: { link: 'https://t.me/invoice/xyz' }, error: null });
    expect(await createProInvoice('signed')).toBe('https://t.me/invoice/xyz');
    expect(invoke).toHaveBeenCalledWith('tg-pay', {
      body: { action: 'create_invoice', initData: 'signed' },
    });
  });

  it('ответ без ссылки — это отказ, а не пустая ссылка', async () => {
    // Отдать undefined дальше значит открыть Telegram пустой адрес: он
    // покажет свою ошибку, и виноватым будет выглядеть Telegram.
    invoke.mockResolvedValue({ data: { link: undefined }, error: null });
    expect(await createProInvoice('signed')).toBeNull();
  });

  it('ссылкой считается только строка', async () => {
    invoke.mockResolvedValue({ data: { link: 12345 }, error: null });
    expect(await createProInvoice('signed')).toBeNull();
  });

  it('ошибка функции не роняет покупку — возвращается null', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await createProInvoice('signed')).toBeNull();
  });
});

describe('bumpGames', () => {
  it('не ходит в сеть без initData', async () => {
    expect(await bumpGames('')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('возвращает новый счётчик', async () => {
    okRpc(12);
    expect(await bumpGames('signed')).toBe(12);
  });

  it('ноль — законное значение, а не «не получилось»', async () => {
    // Классическая ловушка: проверка через `data ? data : null` превратила бы
    // ноль в отказ, и первая игра не засчиталась бы никогда.
    okRpc(0);
    expect(await bumpGames('signed')).toBe(0);
  });

  it('нечисловой ответ отбрасывается', async () => {
    okRpc('12');
    expect(await bumpGames('signed')).toBeNull();
  });

  it('отказ не блокирует старт игры', async () => {
    errRpc('42501');
    expect(await bumpGames('signed')).toBeNull();
  });
});
