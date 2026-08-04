import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  IconMicrophone, IconMicrophoneOff, IconLoader2, IconAlertTriangle,
} from '@tabler/icons-react';
import { useVoice } from './VoiceProvider';
import { voiceEnabled } from './voiceApi';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * The voice channel's controls. Shown in the lobby AND in the game: the
 * session itself lives in VoiceProvider, above the router, so it survives the
 * navigation between them — rendering it only in the lobby used to tear the
 * channel down the moment the game began.
 *
 * The microphone is still asked for on tap, never on app start
 * (docs/VIDEOCHAT_HANDOFF.md §4).
 *
 * Renders nothing at all when voice is not configured, so a deployment
 * without LiveKit looks exactly like today's build.
 */
interface VoiceControlProps {
  roomId: string | null;
  /**
   * Team mode with no team picked yet. The server refuses this with
   * `no_team_yet` — a team-less player has no channel, and the room-wide one
   * would leak both teams' talk. Knowing it in advance lets the lobby say so
   * before the tap instead of after the round trip.
   */
  needsTeam?: boolean;
}

export function VoiceControl({ roomId, needsTeam = false }: VoiceControlProps) {
  // roomId stays in the signature so callers read naturally; the session
  // itself is shared and keyed on the store's room.
  const { t } = useTranslation();
  const { status, reason, level, muted, connect, disconnect, toggleMute } = useVoice();

  if (!voiceEnabled() || !roomId) return null;

  const busy = status === 'connecting';
  const live = status === 'on';
  // Blocked, not broken: the player has something to do about it. Same string
  // the server's own refusal would produce, one round trip earlier.
  const blocked = needsTeam && !live;

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => {
            hapticImpact('light');
            if (live) { void toggleMute(); } else { void connect(); }
          }}
          aria-label={live ? t(muted ? 'voice.unmute' : 'voice.mute') : t('voice.enable')}
          aria-pressed={live && !muted}
          className={clsx(
            'w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border transition-colors',
            live && !muted
              ? 'border-brand-accent bg-brand-accent/15 text-white'
              : 'border-brand-border bg-brand-bg text-brand-muted',
            (busy || blocked) && 'opacity-50',
          )}
        >
          {busy
            ? <IconLoader2 size={18} stroke={2} className="animate-spin" />
            : live && !muted
              ? <IconMicrophone size={18} stroke={2} />
              : <IconMicrophoneOff size={18} stroke={2} />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-white">{t('voice.title')}</p>
          <p className="text-[10.5px] text-brand-muted mt-0.5">
            {blocked && t('voice.reason_no_team_yet')}
            {!blocked && <>
            {status === 'off'         && t('voice.status_off')}
            {status === 'connecting'  && t('voice.status_connecting')}
            {status === 'on'          && t(muted ? 'voice.status_muted' : `voice.level_${level}`)}
            {status === 'denied'      && t('voice.status_denied')}
            {/* Every refusal used to read "Недоступен". The player is now told
                which one it is, because four of them they can act on. */}
            {status === 'unavailable' && t(
              reason ? `voice.reason_${reason}` : 'voice.status_unavailable',
              { defaultValue: t('voice.status_unavailable') },
            )}
            </>}
          </p>
        </div>

        {live && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); disconnect(); }}
            className="text-[10.5px] text-brand-muted hover:text-white shrink-0 transition-colors"
          >
            {t('voice.leave')}
          </button>
        )}
      </div>

      {/* The player is told the link is bad rather than left wondering why
          nobody answers — the handoff asks for the level to be visible. */}
      {live && level === 'text' && (
        <p className="flex items-center gap-1.5 text-[10.5px] text-brand-muted mt-2.5">
          <IconAlertTriangle size={12} stroke={2} />
          {t('voice.level_text_hint')}
        </p>
      )}
    </div>
  );
}
