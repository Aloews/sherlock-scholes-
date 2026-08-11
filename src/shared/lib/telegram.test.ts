// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ПРИГЛАШЕНИЕ — ЭТО ТО, ЧТО СЛОМАЛОСЬ, и его вторая половина жила без единого
// теста. Ссылка `t.me/<бот>?startapp=КОД` требует включённого Main Mini App;
// без него Android отвечает BOT_INVALID, и приглашения не открывали игру вовсе.
// Теперь бот отвечает на `/start КОД` кнопкой web_app, ведущей на `…/?room=КОД`,
// и код приезжает НЕ в start_param, а в обычной строке адреса.
//
// Отсюда два пути доставки одного и того же значения, и ни один не покрывает
// другой. Файл проверяет ровно это место.

/** Ставит клиент Telegram до импорта: `tg` захватывается на уровне модуля. */
function withTelegram(startParam: string | null): void {
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value: startParam === null
      ? undefined
      : { WebApp: { initDataUnsafe: { start_param: startParam } } },
  });
}

function withSearch(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

/** Свежий модуль на каждый случай — иначе первый же импорт зафиксирует `tg`. */
async function load() {
  vi.resetModules();
  return await import('./telegram');
}

beforeEach(() => {
  withTelegram(null);
  withSearch('');
});

afterEach(() => {
  Reflect.deleteProperty(window, 'Telegram');
  window.history.replaceState({}, '', '/');
});

describe('getInviteCode', () => {
  it('читает start_param — форма startapp-ссылки', async () => {
    withTelegram('AB12CD');
    const { getInviteCode } = await load();
    expect(getInviteCode()).toBe('AB12CD');
  });

  // Форма, которой пользуются приглашения сейчас: кнопка web_app от бота.
  it('читает ?room= из адреса — форма кнопки web_app', async () => {
    withSearch('?room=TQ2ZZ3');
    const { getInviteCode } = await load();
    expect(getInviteCode()).toBe('TQ2ZZ3');
  });

  // Telegram ближе к истине, чем строка адреса: её можно набрать руками, а
  // start_param приходит от клиента.
  it('при обеих формах верит start_param', async () => {
    withTelegram('AB12CD');
    withSearch('?room=TQ2ZZ3');
    const { getInviteCode } = await load();
    expect(getInviteCode()).toBe('AB12CD');
  });

  it('без приглашения возвращает пустую строку', async () => {
    const { getInviteCode } = await load();
    expect(getInviteCode()).toBe('');
  });

  // Значение непроверенное по определению — проверку формата делает
  // normalizeCode. Здесь важно только то, что чтение не роняет запуск.
  it('не падает на мусоре в адресе', async () => {
    withSearch('?room=%E0%A4%A');
    const { getInviteCode } = await load();
    expect(typeof getInviteCode()).toBe('string');
  });

  it('другие параметры адреса не путаются с кодом', async () => {
    withSearch('?utm_source=telegram&roomy=NOPE');
    const { getInviteCode } = await load();
    expect(getInviteCode()).toBe('');
  });
});
