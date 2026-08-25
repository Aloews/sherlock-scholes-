import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconFlag } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { OptionRow } from '@/shared/ui/OptionRow';
import { StreamPlayer } from '@/features/stream/StreamPlayer';
import { useChannels } from '@/features/stream/useChannels';
import { buildReportMailto } from '@/features/stream/reportMailto';

// Public by nature, same as VITE_LIVEKIT_URL: the browser has to know where
// to fetch the stream from, so this is not a secret (see .env.example).
//
// ⚠️ ЭТО КАТАЛОГ КАНАЛОВ, А НЕ ПОТОК. Раньше этот адрес уходил прямо в
// StreamPlayer, то есть в hls.loadSource(), и играть там было нечего —
// подробности в шапке features/stream/playlist.ts. Теперь он разбирается, а в
// плеер идёт адрес ВЫБРАННОГО канала.
const PLAYLIST_URL = import.meta.env.VITE_STREAM_URL as string | undefined;

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
  const channels = useChannels(PLAYLIST_URL);
  const [selected, setSelected] = useState<string | null>(null);

  const list = channels.status === 'ok' ? channels.data : [];
  // Группа под названием только когда она РАЗЛИЧАЕТ: сегодня плейлист отдаёт
  // все 31 канал из одной `SPORT 🏆`, и подпись превращается в 31 одинаковую
  // строку шума. Появится вторая группа — подпись вернётся сама.
  const showGroup = new Set(list.map((c) => c.group)).size > 1;
  // Первый канал играет сам: экран, который открывается чёрным прямоугольником
  // и ждёт выбора, читается как сломанный.
  const playing = selected ?? list[0]?.url ?? null;

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

        {!PLAYLIST_URL ? (
          <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.not_configured')}</p>
        ) : (
          <>
            {playing && <StreamPlayer url={playing} />}

            {channels.status === 'loading' && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_loading')}</p>
            )}
            {channels.status === 'error' && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_failed')}</p>
            )}
            {/* Пусто — это НЕ поломка: плейлист живой, но спортивных каналов,
                которые вообще могут проиграться, в нём сегодня нет. */}
            {channels.status === 'ok' && list.length === 0 && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_empty')}</p>
            )}

            {list.length > 0 && (
              <div className="w-full max-w-sm flex flex-col gap-1.5 pt-1">
                <p className="text-brand-muted text-[10.5px] uppercase tracking-wide flex items-center gap-1.5">
                  {t('stream.channels_title')}
                  <span className="tabular-nums opacity-70">{list.length}</span>
                </p>
                {/* OptionRow, а не своя строка: «выбранное» в этом проекте
                    выражают только OptionRow и Chip — см. CLAUDE.md. */}
                {list.map((channel) => (
                  <OptionRow
                    key={channel.url}
                    title={channel.name}
                    description={showGroup ? channel.group || undefined : undefined}
                    selected={channel.url === playing}
                    onClick={() => { hapticImpact('light'); setSelected(channel.url); }}
                  />
                ))}
              </div>
            )}

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
        )}
      </div>
    </div>
  );
}
