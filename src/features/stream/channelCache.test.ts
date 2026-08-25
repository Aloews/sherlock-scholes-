// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCache, writeCache, clearCache, TTL_MS,
         readHealth, markHealth, HEALTH_TTL_MS,
         readFavourites, toggleFavourite } from './channelCache';
import type { Channel } from './playlist';

const SRC = 'https://relay.test/playlist.m3u8';
const ch = (name: string): Channel => ({
  name, group: 'SPORT 🏆', logo: null, url: `https://cdn.test/${name}.m3u8`,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('channelCache', () => {
  it('returns null before anything was written', () => {
    expect(readCache(SRC)).toBeNull();
  });

  it('round-trips a list', () => {
    writeCache(SRC, [ch('Матч! Премьер'), ch('Setanta Sports 1 HD')]);
    expect(readCache(SRC)?.map((c) => c.name)).toEqual(['Матч! Премьер', 'Setanta Sports 1 HD']);
  });

  // Сменился VITE_STREAM_URL — прежний список принадлежит другому каталогу.
  it('ignores a list written for a different playlist url', () => {
    writeCache(SRC, [ch('A')]);
    expect(readCache('https://other.test/playlist.m3u8')).toBeNull();
  });

  it('expires after the TTL', () => {
    const t0 = 1_000_000;
    writeCache(SRC, [ch('A')], t0);
    expect(readCache(SRC, t0 + TTL_MS - 1)).not.toBeNull();
    expect(readCache(SRC, t0 + TTL_MS + 1)).toBeNull();
  });

  // Пустота — состояние сети, а не факт о каталоге. Запомнить её на сутки
  // значит на сутки показывать пустой экран там, где сеть уже починилась.
  it('refuses to remember an empty list', () => {
    writeCache(SRC, []);
    expect(readCache(SRC)).toBeNull();
  });

  it('forgets on clearCache', () => {
    writeCache(SRC, [ch('A')]);
    clearCache();
    expect(readCache(SRC)).toBeNull();
  });

  describe('reads defensively — the list goes straight into the player', () => {
    it('survives outright garbage', () => {
      localStorage.setItem('ss_tv_channels', 'not json at all');
      expect(readCache(SRC)).toBeNull();
    });

    it('rejects an entry from an older format version', () => {
      localStorage.setItem('ss_tv_channels', JSON.stringify({
        v: 0, at: Date.now(), src: SRC, channels: [ch('A')],
      }));
      expect(readCache(SRC)).toBeNull();
    });

    // Ровно то, что уронило бы экран: `undefined.url` в плеере.
    it('rejects a row that is missing url', () => {
      localStorage.setItem('ss_tv_channels', JSON.stringify({
        v: 1, at: Date.now(), src: SRC, channels: [{ name: 'A', group: '', logo: null }],
      }));
      expect(readCache(SRC)).toBeNull();
    });

    it('rejects channels that is not an array', () => {
      localStorage.setItem('ss_tv_channels', JSON.stringify({
        v: 1, at: Date.now(), src: SRC, channels: { name: 'A' },
      }));
      expect(readCache(SRC)).toBeNull();
    });

    it('rejects an entry with no timestamp', () => {
      localStorage.setItem('ss_tv_channels', JSON.stringify({
        v: 1, src: SRC, channels: [ch('A')],
      }));
      expect(readCache(SRC)).toBeNull();
    });
  });

  // Приватный режим и переполненная квота: кэш — ускорение, а не условие
  // работы, и бросать отсюда нельзя.
  it('stays silent when localStorage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeCache(SRC, [ch('A')])).not.toThrow();
  });

  it('stays silent when localStorage throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(readCache(SRC)).toBeNull();
  });
});

describe('память об исходах каналов', () => {
  it('ничего не знает до первой записи', () => {
    expect(readHealth()).toEqual({});
  });

  it('помнит, что канал заиграл и что отказал', () => {
    markHealth('https://a/1.m3u8', 'played');
    markHealth('https://a/2.m3u8', 'failed');
    expect(readHealth()).toEqual({
      'https://a/1.m3u8': 'played',
      'https://a/2.m3u8': 'failed',
    });
  });

  // Канал, заигравший сегодня, важнее вчерашнего отказа: обратное правило
  // хоронило бы его навсегда из-за одной сетевой икоты.
  it('успех перебивает прежний отказ', () => {
    markHealth('https://a/1.m3u8', 'failed');
    markHealth('https://a/1.m3u8', 'played');
    expect(readHealth()['https://a/1.m3u8']).toBe('played');
  });

  it('забывает всё старше суток', () => {
    const t0 = 1_000_000;
    markHealth('https://a/1.m3u8', 'played', t0);
    expect(readHealth(t0 + HEALTH_TTL_MS - 1)).not.toEqual({});
    expect(readHealth(t0 + HEALTH_TTL_MS + 1)).toEqual({});
  });

  it('отбрасывает запись прежней версии формата', () => {
    localStorage.setItem('ss_tv_health', JSON.stringify({
      v: 0, at: Date.now(), urls: { 'https://a/1.m3u8': 'played' },
    }));
    expect(readHealth()).toEqual({});
  });

  it('отбрасывает значения, которых не бывает', () => {
    localStorage.setItem('ss_tv_health', JSON.stringify({
      v: 2, at: Date.now(), urls: { good: 'played', junk: 'что-то ещё' },
    }));
    expect(readHealth()).toEqual({ good: 'played' });
  });

  it('переживает мусор в хранилище', () => {
    localStorage.setItem('ss_tv_health', 'не json');
    expect(readHealth()).toEqual({});
  });

  it('молчит, когда localStorage бросает', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => markHealth('https://a/1.m3u8', 'played')).not.toThrow();
  });

  it('clearCache стирает и исходы тоже', () => {
    markHealth('https://a/1.m3u8', 'played');
    clearCache();
    expect(readHealth()).toEqual({});
  });
});

describe('избранное', () => {
  it('пусто до первой звезды', () => {
    expect(readFavourites()).toEqual([]);
  });

  it('добавляет и убирает', () => {
    expect(toggleFavourite('https://a/1.m3u8')).toEqual(['https://a/1.m3u8']);
    expect(toggleFavourite('https://a/2.m3u8')).toEqual(['https://a/1.m3u8', 'https://a/2.m3u8']);
    expect(toggleFavourite('https://a/1.m3u8')).toEqual(['https://a/2.m3u8']);
  });

  it('переживает после перечитывания', () => {
    toggleFavourite('https://a/1.m3u8');
    expect(readFavourites()).toEqual(['https://a/1.m3u8']);
  });

  // Избранное игрок ставил руками — по таймеру оно не стирается, в отличие
  // от здоровья и каталога.
  it('не имеет срока годности', () => {
    toggleFavourite('https://a/1.m3u8');
    expect(readFavourites()).toEqual(['https://a/1.m3u8']);
    expect(readHealth(Date.now() + HEALTH_TTL_MS * 2)).toEqual({});
  });

  it('отбрасывает мусор из хранилища', () => {
    localStorage.setItem('ss_tv_favourites', 'не json');
    expect(readFavourites()).toEqual([]);
    localStorage.setItem('ss_tv_favourites', JSON.stringify({ not: 'array' }));
    expect(readFavourites()).toEqual([]);
    localStorage.setItem('ss_tv_favourites', JSON.stringify(['https://ok/1.m3u8', 42, 'мусор']));
    expect(readFavourites()).toEqual(['https://ok/1.m3u8']);
  });

  it('молчит, когда localStorage бросает', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => toggleFavourite('https://a/1.m3u8')).not.toThrow();
  });

  it('clearCache стирает и избранное', () => {
    toggleFavourite('https://a/1.m3u8');
    clearCache();
    expect(readFavourites()).toEqual([]);
  });
});
