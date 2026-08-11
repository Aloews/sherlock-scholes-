import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  IconMicrophone, IconMicrophoneOff, IconLoader2, IconAlertTriangle, IconVolumeOff,
  IconVideo, IconVideoOff,
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
 * `compact` is the in-game form: icons only, sized to sit beside the sound
 * button in the score bar. Same session, same taps, no panel — a round has no
 * room for one, and muting yourself mid-explanation should cost one tap.
 *
 * Renders nothing at all when voice is not configured, so a deployment
 * without a voice service looks exactly like today's build.
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
  /** The in-game form: icons only, no panel. */
  compact?: boolean;
}

export function VoiceControl({ roomId, needsTeam = false, compact = false }: VoiceControlProps) {
  // roomId stays in the signature so callers read naturally; the session
  // itself is shared and keyed on the store's room.
  const { t } = useTranslation();
  const {
    status, reason, level, muted, audioBlocked, connect, disconnect, toggleMute, startAudio,
    videoSupported, cameraOn, toggleCamera,
  } = useVoice();

  if (!voiceEnabled() || !roomId) return null;

  const busy = status === 'connecting';
  const live = status === 'on';

  // Blocked, not broken: the player has something to do about it. Same string
  // the server's own refusal would produce, one round trip earlier.
  const blocked = needsTeam && !live;

  const micLabel = blocked
    ? t('voice.reason_no_team_yet')
    : live ? t(muted ? 'voice.unmute' : 'voice.mute') : t('voice.enable');

  const onMic = () => {
    hapticImpact('light');
    if (live) { void toggleMute(); } else { void connect(); }
  };
  // startAudio() must run inside the handler: the gesture is what unblocks
  // playback, and awaiting anything first spends it.
  const onUnblock = () => {
    hapticImpact('light');
    void startAudio();
  };

  // Connected but inaudible is the failure this whole file exists to end, so
  // it outranks "microphone off" in the one line the player reads.
  const liveLabel = audioBlocked
    ? t('voice.audio_blocked')
    : t(muted ? 'voice.status_muted' : `voice.level_${level}`);

  const micIcon = busy
    ? <IconLoader2 size={18} stroke={2} className="animate-spin" />
    : live && !muted
      ? <IconMicrophone size={18} stroke={2} />
      : <IconMicrophoneOff size={18} stroke={2} />;

  // OFFERED ONLY WHEN THE SERVICE ACTUALLY CARRIES ONE. `videoSupported` comes
  // from the transport that connected, not from the build's preferred provider:
  // the failover ladder can land the room on an audio-only vendor, and a camera
  // button that survives that is a button whose only outcome is a thrown error.
  const showCamera = live && videoSupported;
  const onCamera = () => { hapticImpact('light'); void toggleCamera(); };
  const cameraLabel = t(cameraOn ? 'voice.camera_off' : 'voice.camera_on');

  if (compact) {
    return (
      <div className="flex items-center">
        {live && audioBlocked && (
          <button
            type="button"
            onClick={onUnblock}
            aria-label={t('voice.enable_audio')}
            className="p-1.5 rounded-lg text-brand-accent transition-colors"
          >
            <IconVolumeOff size={18} stroke={1.5} />
          </button>
        )}
        <button
          type="button"
          disabled={busy || blocked}
          onClick={onMic}
          aria-label={micLabel}
          aria-pressed={live && !muted}
          className={clsx(
            'p-1.5 rounded-lg transition-colors',
            live && !muted ? 'text-brand-accent' : 'text-brand-muted hover:text-white',
            (busy || blocked) && 'opacity-50',
          )}
        >
          {micIcon}
        </button>
        {showCamera && (
          <button
            type="button"
            onClick={onCamera}
            aria-label={cameraLabel}
            aria-pressed={cameraOn}
            className={clsx(
              'p-1.5 rounded-lg transition-colors',
              cameraOn ? 'text-brand-accent' : 'text-brand-muted hover:text-white',
            )}
          >
            {cameraOn
              ? <IconVideo size={18} stroke={2} />
              : <IconVideoOff size={18} stroke={2} />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || blocked}
          onClick={onMic}
          aria-label={micLabel}
          aria-pressed={live && !muted}
          className={clsx(
            'w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border transition-colors',
            live && !muted
              ? 'border-brand-accent bg-brand-accent/15 text-white'
              : 'border-brand-border bg-brand-bg text-brand-muted',
            (busy || blocked) && 'opacity-50',
          )}
        >
          {micIcon}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-white">{t('voice.title')}</p>
          <p className="text-[10.5px] text-brand-muted mt-0.5">
            {blocked && t('voice.reason_no_team_yet')}
            {!blocked && <>
            {status === 'off'         && t('voice.status_off')}
            {status === 'connecting'  && t('voice.status_connecting')}
            {status === 'on'          && liveLabel}
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

        {showCamera && (
          <button
            type="button"
            onClick={onCamera}
            aria-label={cameraLabel}
            aria-pressed={cameraOn}
            className={clsx(
              'w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border transition-colors',
              cameraOn
                ? 'border-brand-accent bg-brand-accent/15 text-white'
                : 'border-brand-border bg-brand-bg text-brand-muted',
            )}
          >
            {cameraOn
              ? <IconVideo size={18} stroke={2} />
              : <IconVideoOff size={18} stroke={2} />}
          </button>
        )}

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

      {/* The browser refused to play the incoming audio. Nothing is broken and
          reconnecting would not help — only a tap lifts it, so offer one. */}
      {live && audioBlocked && (
        <button
          type="button"
          onClick={onUnblock}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-brand-accent bg-brand-accent/15 text-white text-[11px] py-2 mt-2.5 transition-colors"
        >
          <IconVolumeOff size={13} stroke={2} />
          {t('voice.enable_audio')}
        </button>
      )}

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
