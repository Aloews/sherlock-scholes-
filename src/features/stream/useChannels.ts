import { useEffect, useState } from 'react';
import { LOADING, ok, failed, type LoadState } from '@/shared/lib/loadState';
import { sportChannels, type Channel } from './playlist';
import { readCache, writeCache } from './channelCache';

/**
 * Забрать каталог каналов и разобрать его.
 *
 * ⚠️ КЭШ ПОКАЗЫВАЕТСЯ СРАЗУ, СЕТЬ ИДЁТ СЛЕДОМ. Каталог весит 870 КБ и отдаётся
 * без сжатия — на медленном 3G это семнадцать секунд молчания, за которые игрок
 * успевает решить, что ТВ не работает (подробности и замеры — в шапке
 * ./channelCache.ts). Со вчерашним списком экран живой с первого кадра, а
 * обновление приезжает молча.
 *
 * ⚠️ ПУСТОЙ СПИСОК И ОТКАЗ — РАЗНЫЕ ИСХОДЫ, поэтому здесь `LoadState`, а не
 * `Channel[]`. Ровно на этой границе проект уже спотыкался трижды (см. шапку
 * `shared/lib/loadState.ts`): плейлист может честно не содержать ни одного
 * играбельного спортивного канала — тогда сказать надо «сегодня нечего
 * показать», а не «не загрузилось».
 *
 * ⚠️ ОТКАЗ СЕТИ ПРИ ЖИВОМ КЭШЕ — НЕ ОТКАЗ. Показать «не удалось загрузить»
 * поверх работающего списка значит соврать: каналы есть, играть можно, просто
 * обновиться не вышло.
 *
 * Отменяется через `AbortController`: уход с экрана на середине загрузки не
 * должен дописывать состояние в размонтированный компонент.
 */
export function useChannels(playlistUrl: string | undefined): LoadState<Channel[]> {
  const [state, setState] = useState<LoadState<Channel[]>>(LOADING);

  useEffect(() => {
    if (!playlistUrl) return;

    const cached = readCache(playlistUrl);
    if (cached) setState(ok(cached));
    else setState(LOADING);

    const abort = new AbortController();

    fetch(playlistUrl, { signal: abort.signal })
      .then((res) => {
        // Релей отдаёт каталог как `application/octet-stream`, поэтому по типу
        // содержимого проверять нечего — только по коду ответа.
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.text();
      })
      .then((text) => {
        const fresh = sportChannels(text);
        writeCache(playlistUrl, fresh);
        setState(ok(fresh));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[stream] playlist load failed:', err);
        // Кэш уже показан — оставляем его, а не затираем отказом.
        if (!cached) setState(failed(err instanceof Error ? err.message : 'unknown'));
      });

    return () => abort.abort();
  }, [playlistUrl]);

  return state;
}
