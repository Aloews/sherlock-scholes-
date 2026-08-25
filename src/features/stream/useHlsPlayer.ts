import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export type StreamPlayerStatus = 'loading' | 'ready' | 'error';

/**
 * Сколько ждать первого кадра, прежде чем считать канал неигравшим.
 *
 * ⚠️ БЕЗ ЭТОГО ЭКРАН ЗАВИСАЛ НАСМЕРТЬ. Отказ канала экран узнаёт только из
 * события ошибки — но поток может не ответить ВОВСЕ: хост принимает соединение
 * и молчит, hls.js ждёт манифест и не считает это ошибкой, `video.src` на
 * нативном пути тоже молчит. Ошибки нет, готовности нет, и «Загружаем…» стоит
 * до конца света, хотя рядом в списке есть рабочие каналы.
 *
 * Пятнадцать секунд: живой канал на медленном 3G отдаёт манифест за одну-две,
 * так что запас десятикратный, а игрок не сидит перед чёрным прямоугольником
 * дольше, чем готов ждать.
 */
export const READY_TIMEOUT_MS = 15_000;

/**
 * Attaches an HLS/m3u8 source to a <video> element: native playback where the
 * browser engine supports it (Safari / iOS WebView), hls.js everywhere else
 * (Chrome-based Telegram WebView on Android). Tears down cleanly on unmount
 * or when the url changes, per REACT_STANDARD's "every subscription gets a
 * cleanup" rule.
 */
export function useHlsPlayer(url: string | undefined) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<StreamPlayerStatus>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');

    // Молчащий поток: см. READY_TIMEOUT_MS. Таймер общий для обоих путей и
    // снимается, как только канал заговорил — хоть готовностью, хоть отказом.
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      setStatus('error');
    }, READY_TIMEOUT_MS);
    const settle = (next: StreamPlayerStatus) => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      setStatus(next);
    };
    const stopTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      const onReady = () => settle('ready');
      const onError = () => settle('error');
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
      return () => {
        stopTimer();
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      settle('error');
      return;
    }

    const hls = new Hls();
    hls.on(Hls.Events.MANIFEST_PARSED, () => settle('ready'));

    // ⚠️ НЕ ВСЯКАЯ ФАТАЛЬНАЯ ОШИБКА ЗНАЧИТ «КАНАЛ МЁРТВ», и раньше здесь стояло
    // именно это: `if (data.fatal) setStatus('error')`. Экран на такой отказ
    // помечает канал недоступным и уходит к следующему (см. ./order.ts), то
    // есть один сбойный сегмент НАВСЕГДА выбрасывал живой канал из списка.
    //
    // Различаем по типу, как и предписывает hls.js:
    //   NETWORK_ERROR — манифест не забрать вовсе (404, нет CORS, мёртвый хост).
    //     hls.js уже отретраил своё, прежде чем объявить фатальным; это и есть
    //     настоящее «канал мёртв», восстанавливать нечего.
    //   MEDIA_ERROR — декодер споткнулся. Лечится `recoverMediaError()`, и
    //     ровно один раз: если и после него фатально, канал правда не играет,
    //     а бесконечный цикл восстановления хуже честного отказа.
    let mediaRecovered = false;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // `data.type &&` не для красоты: без него событие без типа совпало бы с
      // `undefined` и ушло в восстановление вместо честного отказа.
      if (data.type && data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
        mediaRecovered = true;
        hls.recoverMediaError();
        return;
      }
      settle('error');
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    return () => { stopTimer(); hls.destroy(); };
  }, [url]);

  return { videoRef, status };
}
