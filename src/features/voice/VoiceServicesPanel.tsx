import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { IconCircleCheck, IconCircleDashed, IconLoader2, IconAlertTriangle } from '@tabler/icons-react';
import { useVoice } from './VoiceProvider';
import { voiceProvider, voiceProviderMisconfigured } from './providers';
import { serviceRows, formatStats, type ServiceRow, type ServiceState } from './serviceStatus';

/** Vendor names are trademarks: the same in every locale, never translated. */
const SERVICE_NAMES = { livekit: 'LiveKit', daily: 'Daily', agora: 'Agora' } as const;

/**
 * Which voice service this build talks to, and how the link is doing.
 *
 * Companion to SoundCheckPanel: that one answers "does this device work",
 * this one answers "which service are we even on, and is it up". Both live in
 * the profile, because both are questions asked when something is wrong.
 *
 * Two of the three rows always read "not in this build" — that is correct, not
 * a fault. Only one adapter is compiled in (providers/index.ts), and the two
 * SDKs that are absent are absent on purpose.
 */
export function VoiceServicesPanel() {
  const { t } = useTranslation();
  const { status, reason, detail, level, linkStats, audioBlocked } = useVoice();

  const rows = serviceRows({
    active: voiceProvider(),
    misconfigured: voiceProviderMisconfigured(),
    status,
    reason,
    level,
    stats: linkStats,
    audioBlocked,
    detail,
  });

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm text-white font-semibold">{t('voice_services.title')}</p>
        <p className="text-[11px] text-brand-muted mt-1 leading-relaxed">
          {t('voice_services.intro')}
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => (
          <ServiceLine key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function ServiceLine({ row }: { row: ServiceRow }) {
  const { t } = useTranslation();
  const absent = row.state === 'absent';

  return (
    <li
      className={clsx(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2',
        absent ? 'border-brand-border/50 bg-brand-bg/40' : 'border-brand-border bg-brand-bg',
      )}
    >
      <span className={clsx('mt-0.5 shrink-0', toneClass(row.state))}>
        <StateIcon state={row.state} />
      </span>

      <div className="min-w-0 flex-1">
        <p className={clsx('text-xs', absent ? 'text-brand-muted' : 'text-white')}>
          {SERVICE_NAMES[row.id]}
        </p>
        <p className="text-[10.5px] text-brand-muted mt-0.5">
          {row.state === 'failed' && row.reason
            ? t(`voice.reason_${row.reason}`, { defaultValue: t('voice_services.state_failed') })
            : t(`voice_services.state_${row.state}`)}
        </p>

        {/* What the service itself said. Untranslated by design: it is a
            vendor's own message, and paraphrasing it would lose the only
            string that can be searched for. */}
        {row.detail && (
          <p className="text-[10.5px] text-brand-muted/70 mt-0.5 break-words">{row.detail}</p>
        )}

        {/* Raw numbers, not just the smoothed level: a link on its way down is
            visible here a good while before the ladder admits it. */}
        {row.stats && (
          <p className="text-[10.5px] text-brand-muted/80 mt-0.5 tabular-nums">
            {t('voice_services.link', {
              ...formatStats(row.stats),
              quality: t(`voice.level_${row.level ?? 'voice'}`),
            })}
          </p>
        )}
      </div>
    </li>
  );
}

function StateIcon({ state }: { state: ServiceState }) {
  if (state === 'connecting') return <IconLoader2 size={14} stroke={2} className="animate-spin" />;
  if (state === 'live') return <IconCircleCheck size={14} stroke={2} />;
  if (state === 'failed' || state === 'misconfigured' || state === 'blocked' || state === 'denied') {
    return <IconAlertTriangle size={14} stroke={2} />;
  }
  return <IconCircleDashed size={14} stroke={2} />;
}

function toneClass(state: ServiceState): string {
  switch (state) {
    case 'live':          return 'text-brand-accent';
    case 'blocked':
    case 'denied':
    case 'failed':
    case 'misconfigured': return 'text-red-400';
    // `absent` and `off` are both ordinary states, and neither is a warning.
    default:              return 'text-brand-muted';
  }
}
