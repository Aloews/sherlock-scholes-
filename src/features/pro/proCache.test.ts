// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { cacheKey, readProCache, writeProCache, clearProCache } from './proCache';

// Настоящий initData подписан, но подпись здесь ни при чём: памятка берёт из
// строки только ИДЕНТИФИКАТОР и только как ключ. Проверять подпись — дело
// сервера (tg_validate_init_data), и это записано в шапке proCache.ts.
const init = (id: number) =>
  `query_id=A&user=${encodeURIComponent(JSON.stringify({ id, first_name: 'Х' }))}&auth_date=1&hash=ff`;

const T0 = 1_700_000_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe('proCache: ключ', () => {
  it('берёт идентификатор игрока', () => {
    expect(cacheKey(init(42))).toBe('sherlock.pro.42');
  });

  it('разным игрокам — разные ключи', () => {
    expect(cacheKey(init(1))).not.toBe(cacheKey(init(2)));
  });

  it('пустая строка — не ключ', () => {
    expect(cacheKey('')).toBeNull();
  });

  it('без поля user — не ключ', () => {
    expect(cacheKey('query_id=A&auth_date=1&hash=ff')).toBeNull();
  });

  it('user не разбирается как JSON — не ключ, а не падение', () => {
    expect(cacheKey('user=%7Bне-json&auth_date=1')).toBeNull();
  });

  it('id не число — не ключ', () => {
    expect(cacheKey(`user=${encodeURIComponent('{"id":"42"}')}`)).toBeNull();
  });
});

describe('proCache: запись и чтение', () => {
  beforeEach(() => { localStorage.clear(); });

  it('что записали, то и прочли', () => {
    writeProCache(init(7), { isPro: true, gamesPlayed: 12 }, T0);
    expect(readProCache(init(7), T0 + 1000)).toEqual({ isPro: true, gamesPlayed: 12 });
  });

  it('ПАМЯТКА ОДНОГО НЕ ОТКРЫВАЕТ ЭКРАН ДРУГОМУ', () => {
    writeProCache(init(7), { isPro: true, gamesPlayed: 0 }, T0);
    expect(readProCache(init(8), T0 + 1000)).toBeNull();
  });

  it('пусто, пока ничего не записано', () => {
    expect(readProCache(init(7), T0)).toBeNull();
  });

  it('ЧЕРЕЗ НЕДЕЛЮ ПАМЯТКА ПРОТУХАЕТ — отменённая подписка не вечна', () => {
    writeProCache(init(7), { isPro: true, gamesPlayed: 0 }, T0);
    expect(readProCache(init(7), T0 + WEEK - 1)).not.toBeNull();
    expect(readProCache(init(7), T0 + WEEK + 1)).toBeNull();
  });

  it('запись из будущего отвергается — часы переводили назад', () => {
    writeProCache(init(7), { isPro: true, gamesPlayed: 0 }, T0 + 60_000);
    expect(readProCache(init(7), T0)).toBeNull();
  });

  it('«не подписчик» тоже помнится: ворота обязаны закрыться сразу', () => {
    writeProCache(init(7), { isPro: false, gamesPlayed: 3 }, T0);
    expect(readProCache(init(7), T0 + 1000)).toEqual({ isPro: false, gamesPlayed: 3 });
  });

  it('clearProCache стирает', () => {
    writeProCache(init(7), { isPro: true, gamesPlayed: 0 }, T0);
    clearProCache(init(7));
    expect(readProCache(init(7), T0 + 1000)).toBeNull();
  });

  it('битая запись — не падение, а промах', () => {
    localStorage.setItem('sherlock.pro.7', 'не json');
    expect(readProCache(init(7), T0)).toBeNull();
  });

  it('запись без isPro — промах, а не «false»', () => {
    localStorage.setItem('sherlock.pro.7', JSON.stringify({ gamesPlayed: 1, at: T0 }));
    expect(readProCache(init(7), T0)).toBeNull();
  });

  it('без initData ничего не пишется и не читается', () => {
    writeProCache('', { isPro: true, gamesPlayed: 0 }, T0);
    expect(localStorage.length).toBe(0);
    expect(readProCache('', T0)).toBeNull();
  });
});
