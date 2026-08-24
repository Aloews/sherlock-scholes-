import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconFlag } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { StreamPlayer } from '@/features/stream/StreamPlayer';
import { buildReportMailto } from '@/features/stream/reportMailto';

// Public by nature, same as VITE_LIVEKIT_URL: the browser has to know where
// to fetch the stream from, so this is not a secret (see .env.example).
const STREAM_URL = import.meta.env.VITE_STREAM_URL as string | undefined;

// Rights-holder complaint contact. Unset: no report link is rendered rather
// than a dead mailto:undefined. See docs/ADR/0004 for the takedown process
// this exists for (one verified complaint -> pull VITE_STREAM_URL or set
// VITE_STREAM_HIDDEN, see HomeScreen.tsx).
const ABUSE_CONTACT = import.meta.env.VITE_STREAM_ABUSE_CONTACT as string | undefined;

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
          <>
            <StreamPlayer url={STREAM_URL} />
            {ABUSE_CONTACT && (
              <a
                href={buildReportMailto(
                  ABUSE_CONTACT,
                  t('stream.report_subject'),
                  t('stream.report_body'),
                )}
                onClick={() => hapticImpact('light')}
                className="flex items-center gap-1.5 text-brand-muted text-[10.5px] underline underline-offset-2 pt-1"
              >
                <IconFlag size={13} stroke={1.75} />
                {t('stream.report_link')}
              </a>
            )}
          </>
        ) : (
          <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.not_configured')}</p>
        )}
      </div>
    </div>
  );
}
