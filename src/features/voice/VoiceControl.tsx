import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  IconMicrophone, IconMicrophoneOff, IconLoader2, IconAlertTriangle,
} from '@tabler/icons-react';
import { useVoiceChat } from './useVoiceChat';
import { voiceEnabled } from './voiceApi';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * The voice channel's only entry point. Lives in the lobby, because that is
 * where the microphone prompt belongs (docs/VIDEOCHAT_HANDOFF.md §4) — not on
 * app start, when the player has not asked for anything.
 *
 * Renders nothing at all when voice is not configured, so a deployment
 * without LiveKit looks exactly like today's build.
 */
export function VoiceControl({ roomId }: { roomId: string | null }) {
  const { t } = useTranslation();
  const { status, level, muted, connect, disconnect, toggleMute } = useVoiceChat(roomId);

  if (!voiceEnabled() || !roomId) return null;

  const busy = status === 'connecting';
  const live = status === 'on';

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
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
            busy && 'opacity-50',
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
            {status === 'off'         && t('voice.status_off')}
            {status === 'connecting'  && t('voice.status_connecting')}
            {status === 'on'          && t(muted ? 'voice.status_muted' : `voice.level_${level}`)}
            {status === 'denied'      && t('voice.status_denied')}
            {status === 'unavailable' && t('voice.status_unavailable')}
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
