import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  IconMicrophone, IconLoader2, IconAlertTriangle, IconVolumeOff, IconHeadphones, IconCheck,
} from '@tabler/icons-react';
import { useSoundCheck, heardSomething } from './useSoundCheck';
import { hapticImpact } from '@/shared/lib/telegram';

/**
 * "Проверить звук" — the device half of the voice diagnosis.
 *
 * `npm run check:voice` settles the server. This settles the two things it
 * cannot reach: whether this device gives up a microphone at all, and whether
 * this browser will play what arrives. Both are answered without a room, a
 * token or a second player — so a failing answer here is not something a
 * teammate, a channel or a provider could have caused.
 *
 * It deliberately uses the same path a real call uses: getUserMedia with the
 * same constraints, and playback through an <audio> element in the document
 * with play() watched for a refusal. A check that took a shortcut would pass
 * where the call fails, which is worse than no check.
 */
export function SoundCheckPanel() {
  const { t } = useTranslation();
  const { stage, level, peak, playbackBlocked, monitoring, start, stop, toggleMonitor } = useSoundCheck();

  const running = stage === 'running';
  const busy = stage === 'asking';
  const hearing = heardSomething(peak);

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm text-white font-semibold">{t('soundcheck.title')}</p>
        <p className="text-[11px] text-brand-muted mt-1 leading-relaxed">{t('soundcheck.intro')}</p>
      </div>

      {running && (
        <div className="space-y-2">
          {/* The meter is the proof a microphone is live. A number would be
              read as a claim; a bar that moves when you speak is evidence. */}
          <div className="h-2 rounded-full bg-brand-bg border border-brand-border overflow-hidden">
            <div
              className={clsx('h-full transition-[width] duration-75', hearing ? 'bg-brand-accent' : 'bg-brand-muted/40')}
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <p className={clsx('text-[11px] flex items-center gap-1.5', hearing ? 'text-white' : 'text-brand-muted')}>
            {hearing ? <IconCheck size={13} stroke={2} /> : <IconMicrophone size={13} stroke={2} />}
            {t(hearing ? 'soundcheck.listening' : 'soundcheck.silent')}
          </p>
        </div>
      )}

      {stage === 'denied' && (
        <p className="text-[11px] text-brand-muted flex items-center gap-1.5">
          <IconAlertTriangle size={13} stroke={2} />
          {t('soundcheck.denied')}
        </p>
      )}
      {stage === 'failed' && (
        <p className="text-[11px] text-brand-muted flex items-center gap-1.5">
          <IconAlertTriangle size={13} stroke={2} />
          {t('soundcheck.failed')}
        </p>
      )}

      {/* The same refusal that made a connected room silent, caught the same
          way. If it shows up here, it is the device — not the channel. */}
      {running && playbackBlocked && (
        <p className="text-[11px] text-white flex items-center gap-1.5 rounded-xl border border-brand-accent bg-brand-accent/15 px-3 py-2">
          <IconVolumeOff size={13} stroke={2} />
          {t('soundcheck.blocked')}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => { hapticImpact('light'); if (running) { stop(); } else { void start(); } }}
          className={clsx(
            'flex-1 h-10 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5',
            running
              ? 'border-brand-border bg-brand-bg text-brand-muted'
              : 'border-brand-accent bg-brand-accent/15 text-white',
            busy && 'opacity-50',
          )}
        >
          {busy && <IconLoader2 size={14} stroke={2} className="animate-spin" />}
          {t(busy ? 'soundcheck.asking' : running ? 'soundcheck.stop' : 'soundcheck.start')}
        </button>

        {running && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); void toggleMonitor(); }}
            aria-pressed={monitoring}
            className={clsx(
              'h-10 px-3 rounded-xl border text-xs transition-colors flex items-center gap-1.5',
              monitoring
                ? 'border-brand-accent bg-brand-accent/15 text-white'
                : 'border-brand-border bg-brand-bg text-brand-muted',
            )}
          >
            <IconHeadphones size={14} stroke={2} />
            {t(monitoring ? 'soundcheck.monitor_off' : 'soundcheck.monitor_on')}
          </button>
        )}
      </div>

      {/* Playing a microphone back through a phone's own speaker is a feedback
          loop. Saying so before the tap, not after the howl. */}
      {running && <p className="text-[10.5px] text-brand-muted">{t('soundcheck.monitor_hint')}</p>}
    </div>
  );
}
