// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useChannels } from './useChannels';
import { CACHE_VERSION } from './channelCache';

const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="SPORT 🏆",Red Bull TV',
  'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
  '#EXTINF:-1 group-title="SPORT 🏆",Матч ТВ',
  'http://37.230.164.98:8080/matchtv/index.m3u8',
  '#EXTINF:-1 group-title="KINO ZAL",Анаконда 2025',
  'https://zetvideo.net/content/stream/films/anaconda/index.m3u8',
].join('\n');

function Harness({ url }: { url?: string }) {
  const state = useChannels(url);
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="names">
        {state.status === 'ok' ? state.data.map((c) => c.name).join('|') : ''}
      </span>
    </div>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // ⚠️ КЭШ ЖИВЁТ МЕЖДУ ТЕСТАМИ, если его не чистить: удачная загрузка в одном
  // тесте делала следующий «отказ» неотличимым от успеха, потому что хук по
  // замыслу оставляет показанный список вместо ошибки.
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useChannels', () => {
  it('parses the playlist and keeps only playable sport channels', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => PLAYLIST });
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('ok');
    expect(screen.getByTestId('names').textContent).toBe('Red Bull TV');
  });

  // Тот самый разрыв, ради которого здесь LoadState, а не Channel[]: живой
  // плейлист без спортивных каналов — это не поломка.
  it('reports ok with an empty list, not an error, when nothing matches', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '#EXTM3U\n#EXTINF:-1 group-title="KINO ZAL",Фильм\nhttps://a/b.m3u8',
    });
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('ok');
    expect(screen.getByTestId('names').textContent).toBe('');
  });

  it('reports an error when the relay answers with a failure code', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => '' });
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('reports an error when the relay is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('stays loading and never fetches when the url is unset', async () => {
    render(<Harness url={undefined} />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('loading');
  });

  // Каталог весит под мегабайт: уход с экрана на середине загрузки не должен
  // дописывать состояние в размонтированный компонент.
  it('aborts the in-flight request on unmount', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    const { unmount } = render(<Harness url="https://relay/playlist.m3u8" />);
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('refetches when the url changes', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => PLAYLIST });
    const { rerender } = render(<Harness url="https://relay/a.m3u8" />);
    await settle();
    rerender(<Harness url="https://relay/b.m3u8" />);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://relay/b.m3u8');
  });
});

describe('кэш списка каналов', () => {
  const CACHED = [{ name: 'Вчерашний', group: 'SPORT 🏆', logo: null, url: 'https://cdn/a.m3u8' }];
  // ⚠️ ВЕРСИЯ ФОРМАТА ДОЛЖНА СОВПАДАТЬ С ТЕКУЩЕЙ. Когда формат вырос до 2,
  // эти два теста честно упали: `readCache` отбрасывает чужую версию, и
  // фикстура с `v: 1` перестала читаться. Ровно то поведение, ради которого
  // версия и заведена, — поэтому здесь стоит константа, а не число.
  const put = () => localStorage.setItem('ss_tv_channels', JSON.stringify({
    v: CACHE_VERSION, at: Date.now(), src: 'https://relay/playlist.m3u8', channels: CACHED,
  }));

  // Ради этого всё и сделано: каталог весит 870 КБ и не сжимается, на 3G это
  // семнадцать секунд молчания — и игрок решает, что ТВ не работает.
  it('shows the cached list immediately, before the network answers', async () => {
    put();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('ok');
    expect(screen.getByTestId('names').textContent).toBe('Вчерашний');
  });

  it('replaces the cached list once the network answers', async () => {
    put();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => PLAYLIST });
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('names').textContent).toBe('Red Bull TV');
  });

  // Каналы есть, играть можно — просто обновиться не вышло. Показать поверх
  // рабочего списка «не удалось загрузить» значит соврать.
  it('keeps the cached list when the refresh fails', async () => {
    put();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('ok');
    expect(screen.getByTestId('names').textContent).toBe('Вчерашний');
  });

  it('writes what it parsed, so the next visit is instant', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => PLAYLIST });
    render(<Harness url="https://relay/playlist.m3u8" />);
    await settle();

    const raw = localStorage.getItem('ss_tv_channels');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).channels.map((c: { name: string }) => c.name)).toEqual(['Red Bull TV']);
  });
});
