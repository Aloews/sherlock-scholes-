import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useHlsPlayer } from './useHlsPlayer';

interface StreamPlayerProps {
  url: string;
  /**
   * Канал не заигрался. ⚠️ ОБ ОТКАЗЕ ОБЯЗАН УЗНАТЬ ЭКРАН, а не только зритель:
   * отказывает каждый четвёртый канал (замер — в шапке ./order.ts), и молчащий
   * плеер превращал это в «ТВ не работает». Экран на это уходит к следующему.
   */
  onFailed?: (url: string) => void;
  /** Канал заиграл. Экран это запоминает и в следующий раз ставит его первым. */
  onPlaying?: (url: string) => void;
}

// Dumb-ish feature component: owns the hls.js lifecycle via useHlsPlayer,
// renders loading/error states over the <video> per REACT_STANDARD §6
// ("every async view renders loading/error/empty/success explicitly").
export function StreamPlayer({ url, onFailed, onPlaying }: StreamPlayerProps) {
  const { t } = useTranslation();
  const { videoRef, status } = useHlsPlayer(url);

  // Сообщаем НЕ из обработчика hls.js, а из эффекта по смене статуса: так
  // отказ уходит наверх ровно один раз на канал, сколько бы фатальных событий
  // hls.js ни прислал по одному и тому же потоку.
  useEffect(() => {
    if (status === 'error') onFailed?.(url);
    if (status === 'ready') onPlaying?.(url);
  }, [status, url, onFailed, onPlaying]);

  return (
    <div className="w-full max-w-sm rounded-2xl overflow-hidden bg-black relative aspect-video">
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        playsInline
        autoPlay
        muted
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-brand-muted text-[12px] bg-black/40">
          {t('stream.loading')}
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-brand-muted text-[12px] px-4 text-center bg-black/60">
          {t('stream.error')}
        </div>
      )}
    </div>
  );
}
