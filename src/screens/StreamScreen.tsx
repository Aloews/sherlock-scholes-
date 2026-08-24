import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { StreamPlayer } from '@/features/stream/StreamPlayer';

// Public by nature, same as VITE_LIVEKIT_URL: the browser has to know where
// to fetch the stream from, so this is not a secret (see .env.example).
const STREAM_URL = import.meta.env.VITE_STREAM_URL as string | undefined;

/**
 * Live TV — a standalone m3u/HLS channel relay, unrelated to the Alias
 * gameplay. Deliberately its own screen off the home game-link list (not the
 * bottom tab bar, which is reserved for the four core tabs) so it never
 * competes with a live round for screen space.
 */
export function StreamScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('stream.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col items-center gap-3">
        <p className="text-brand-muted text-[10.5px] pb-2 self-start">{t('stream.note')}</p>
        {STREAM_URL ? (
          <StreamPlayer url={STREAM_URL} />
        ) : (
          <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.not_configured')}</p>
        )}
      </div>
    </div>
  );
}
