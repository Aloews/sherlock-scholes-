import { useEffect, useState } from 'react';
import { LOADING, ok, failed, type LoadState } from '@/shared/lib/loadState';
import { sportChannels, type Channel } from './playlist';

/**
 * Забрать каталог каналов и разобрать его.
 *
 * ⚠️ ПУСТОЙ СПИСОК И ОТКАЗ — РАЗНЫЕ ИСХОДЫ, поэтому здесь `LoadState`, а не
 * `Channel[]`. Ровно на этой границе проект уже спотыкался трижды (см. шапку
 * `shared/lib/loadState.ts`): плейлист может честно не содержать ни одного
 * играбельного спортивного канала — тогда сказать надо «сегодня нечего
 * показать», а не «не загрузилось». Разница видна только если её сохранить.
 *
 * Отменяется через `AbortController`: каталог весит под мегабайт, и уход с
 * экрана на середине загрузки не должен дописывать состояние в размонтированный
 * компонент.
 */
export function useChannels(playlistUrl: string | undefined): LoadState<Channel[]> {
  const [state, setState] = useState<LoadState<Channel[]>>(LOADING);

  useEffect(() => {
    if (!playlistUrl) return;

    const abort = new AbortController();
    setState(LOADING);

    fetch(playlistUrl, { signal: abort.signal })
      .then((res) => {
        // Релей отдаёт каталог как `application/octet-stream`, поэтому по типу
        // содержимого проверять нечего — только по коду ответа.
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.text();
      })
      .then((text) => setState(ok(sportChannels(text))))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[stream] playlist load failed:', err);
        setState(failed(err instanceof Error ? err.message : 'unknown'));
      });

    return () => abort.abort();
  }, [playlistUrl]);

  return state;
}
