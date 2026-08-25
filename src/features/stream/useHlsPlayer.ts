import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export type StreamPlayerStatus = 'loading' | 'ready' | 'error';

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

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      const onReady = () => setStatus('ready');
      const onError = () => setStatus('error');
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
      return () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      setStatus('error');
      return;
    }

    const hls = new Hls();
    hls.on(Hls.Events.MANIFEST_PARSED, () => setStatus('ready'));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setStatus('error');
    });
    hls.loadSource(url);
    hls.attachMedia(video);

    return () => hls.destroy();
  }, [url]);

  return { videoRef, status };
}
