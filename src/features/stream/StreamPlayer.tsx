import { useTranslation } from 'react-i18next';
import { useHlsPlayer } from './useHlsPlayer';

interface StreamPlayerProps {
  url: string;
}

// Dumb-ish feature component: owns the hls.js lifecycle via useHlsPlayer,
// renders loading/error states over the <video> per REACT_STANDARD §6
// ("every async view renders loading/error/empty/success explicitly").
export function StreamPlayer({ url }: StreamPlayerProps) {
  const { t } = useTranslation();
  const { videoRef, status } = useHlsPlayer(url);

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
