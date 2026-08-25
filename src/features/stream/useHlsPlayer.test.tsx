// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useHlsPlayer } from './useHlsPlayer';

// hls.js is mocked wholesale: this test is about our own state machine
// (loading -> ready/error, cleanup on unmount/url change), not hls.js's
// internals — those belong to hls.js's own test suite.
const hls = vi.hoisted(() => ({
  state: {
    isSupported: true,
    instances: [] as FakeHlsInstance[],
  },
}));

interface FakeHlsInstance {
  handlers: Record<string, (...args: unknown[]) => void>;
  destroyed: boolean;
  recovered: number;
  emit(event: string, data?: unknown): void;
}

vi.mock('hls.js', () => {
  class FakeHls implements FakeHlsInstance {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    destroyed = false;
    static Events = { MANIFEST_PARSED: 'hlsManifestParsed', ERROR: 'hlsError' };
    // Те же строки, что в настоящем hls.js — хук сравнивает с ними тип ошибки.
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    recovered = 0;
    recoverMediaError() { this.recovered += 1; }
    static isSupported() { return hls.state.isSupported; }
    on(event: string, cb: (...args: unknown[]) => void) { this.handlers[event] = cb; }
    loadSource(_url: string) { /* no-op: state driven by emit() in tests */ }
    attachMedia(_video: HTMLVideoElement) { /* no-op */ }
    destroy() { this.destroyed = true; }
    emit(event: string, data?: unknown) { this.handlers[event]?.(event, data); }
    constructor() { hls.state.instances.push(this); }
  }
  return { default: FakeHls };
});

function Harness({ url }: { url?: string }) {
  const { videoRef, status } = useHlsPlayer(url);
  return (
    <>
      <video ref={videoRef} data-testid="video" />
      <span data-testid="status">{status}</span>
    </>
  );
}

function currentStatus() {
  return screen.getByTestId('status').textContent;
}

beforeEach(() => {
  hls.state.isSupported = true;
  hls.state.instances = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useHlsPlayer', () => {
  it('stays in loading and creates no hls.js instance when no url is given', () => {
    render(<Harness />);
    expect(currentStatus()).toBe('loading');
    expect(hls.state.instances).toHaveLength(0);
  });

  it('uses hls.js when the video element has no native HLS support, and resolves on MANIFEST_PARSED', () => {
    // jsdom's <video>.canPlayType always reports no support, same as a
    // Chrome-based WebView (the real-world case this branch exists for).
    render(<Harness url="https://example.com/playlist.m3u8" />);
    expect(hls.state.instances).toHaveLength(1);
    expect(currentStatus()).toBe('loading');

    act(() => hls.state.instances[0].emit('hlsManifestParsed'));
    expect(currentStatus()).toBe('ready');
  });

  // Сетевая ошибка — это и есть «канал мёртв»: 404, отсутствующий CORS,
  // мёртвый хост. hls.js уже отретраил своё, прежде чем объявить её фатальной.
  it('reports error on a fatal network error, without trying to recover', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true, type: 'networkError' }));
    expect(currentStatus()).toBe('error');
    expect(hls.state.instances[0].recovered).toBe(0);
  });

  // ⚠️ РАДИ ЭТОГО ВСЁ И ПЕРЕПИСАНО. Экран помечает отказавший канал недоступным
  // НАВСЕГДА и уходит к следующему, поэтому один споткнувшийся сегмент раньше
  // выбрасывал живой канал из списка до конца сеанса.
  it('recovers from a fatal media error instead of declaring the channel dead', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true, type: 'mediaError' }));
    expect(hls.state.instances[0].recovered).toBe(1);
    expect(currentStatus()).not.toBe('error');
  });

  // Ровно один раз: вечный цикл восстановления хуже честного отказа.
  it('gives up after the second fatal media error', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true, type: 'mediaError' }));
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true, type: 'mediaError' }));
    expect(hls.state.instances[0].recovered).toBe(1);
    expect(currentStatus()).toBe('error');
  });

  it('reports error on a fatal error of any other type', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true, type: 'otherError' }));
    expect(currentStatus()).toBe('error');
  });

  // Событие без типа не должно совпасть с `undefined` и уйти в восстановление.
  it('treats a fatal error with no type as a failure, not something to recover', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: true }));
    expect(hls.state.instances[0].recovered).toBe(0);
    expect(currentStatus()).toBe('error');
  });

  it('ignores a non-fatal hls.js error', () => {
    render(<Harness url="https://example.com/playlist.m3u8" />);
    act(() => hls.state.instances[0].emit('hlsError', { fatal: false }));
    expect(currentStatus()).toBe('loading');
  });

  it('destroys the hls.js instance on unmount', () => {
    const { unmount } = render(<Harness url="https://example.com/playlist.m3u8" />);
    const instance = hls.state.instances[0];
    unmount();
    expect(instance.destroyed).toBe(true);
  });

  it('reports error immediately when neither native HLS nor hls.js is supported', () => {
    hls.state.isSupported = false;
    render(<Harness url="https://example.com/playlist.m3u8" />);
    expect(currentStatus()).toBe('error');
    expect(hls.state.instances).toHaveLength(0);
  });

  it('uses native playback when the video element reports HLS support (Safari/iOS)', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    render(<Harness url="https://example.com/playlist.m3u8" />);
    // Native path never touches hls.js at all.
    expect(hls.state.instances).toHaveLength(0);
    expect(currentStatus()).toBe('loading');

    const video = screen.getByTestId('video');
    act(() => video.dispatchEvent(new Event('loadedmetadata')));
    expect(currentStatus()).toBe('ready');
  });

  it('reports error when native playback fires an error event', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    render(<Harness url="https://example.com/playlist.m3u8" />);
    const video = screen.getByTestId('video');
    act(() => video.dispatchEvent(new Event('error')));
    expect(currentStatus()).toBe('error');
  });
});
