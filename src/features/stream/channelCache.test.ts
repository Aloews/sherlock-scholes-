// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCache, writeCache, clearCache, TTL_MS } from './channelCache';
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
