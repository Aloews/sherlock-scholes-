import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMinus, IconPlus, IconCheck } from '@tabler/icons-react';
import { getRawInitData, hapticImpact, hapticError } from '@/shared/lib/telegram';
import { predictMatch, type Prediction } from './predictionsApi';
import type { Fixture } from './fixturesApi';

/** Nobody predicts 100–0, and a stepper that runs forever is a stepper nobody
 *  can reach the end of. The database agrees (check constraint at 99). */
const MAX_GOALS = 20;

/**
 * The prediction attached to one match.
 *
 * Three states, and they are visibly different because they mean different
 * things: not predicted, predicted and waiting, settled with points. The
 * middle one is the one that usually gets collapsed into the others, and it is
 * the one a player checks back for.
 *
 * WHY STEPPERS AND NOT A TEXT FIELD. A score is two small numbers, and a
 * numeric keyboard over a list is the same trap the room code had — the field
 * ends up under the keyboard. Two taps beat a keyboard for 0–5, which is
 * almost every football score.
 */
export function PredictionRow({
  fixture,
  existing,
  onSaved,
}: {
  fixture: Fixture;
  existing: Prediction | undefined;
  onSaved: (prediction: Prediction) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(existing?.home_score ?? 0);
  const [away, setAway] = useState(existing?.away_score ?? 0);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);

  const settled = existing?.settled_at != null;

  const save = async () => {
    setSaving(true);
    const ok = await predictMatch(getRawInitData(), fixture.id, home, away);
    setSaving(false);
    if (!ok) {
      // The server refuses a match that has kicked off, and it decides that
      // with its own clock. Showing a tick here would be a lie about a
      // prediction that was never recorded.
      setRefused(true);
      hapticError();
      return;
    }
    hapticImpact('light');
    setOpen(false);
    onSaved({ fixture_id: fixture.id, home_score: home, away_score: away, points: null, settled_at: null });
  };

  if (settled) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-brand-muted">
          {t('matches.your_prediction')} {existing!.home_score}:{existing!.away_score}
        </span>
        <span className="text-white font-bold">
          {t('matches.points_awarded', { n: existing!.points ?? 0 })}
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { hapticImpact('light'); setOpen(true); }}
        className="text-[11px] text-brand-muted hover:text-white transition-colors"
      >
        {existing
          ? `${t('matches.your_prediction')} ${existing.home_score}:${existing.away_score} · ${t('matches.points_pending')}`
          : t('matches.predict')}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Stepper value={home} onChange={setHome} label={fixture.home_team} />
      <span className="text-brand-muted text-xs">:</span>
      <Stepper value={away} onChange={setAway} label={fixture.away_team} />

      <button
        type="button"
        disabled={saving}
        onClick={() => { void save(); }}
        className="ml-auto flex items-center gap-1 text-[11px] text-white bg-brand-accent/20 border border-brand-accent/40 rounded-lg px-2 py-1 disabled:opacity-50"
      >
        <IconCheck size={13} stroke={2.5} />
        {t('matches.predict_save')}
      </button>

      {refused && (
        <p className="w-full text-[10.5px] text-brand-muted">{t('matches.predict_closed')}</p>
      )}
    </div>
  );
}

function Stepper({
  value, onChange, label,
}: { value: number; onChange: (next: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`${label} −1`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="w-6 h-6 rounded-md border border-brand-border text-brand-muted flex items-center justify-center"
      >
        <IconMinus size={12} stroke={2.5} />
      </button>
      <span className="ds-display text-white text-sm font-bold w-5 text-center tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`${label} +1`}
        onClick={() => onChange(Math.min(MAX_GOALS, value + 1))}
        className="w-6 h-6 rounded-md border border-brand-border text-brand-muted flex items-center justify-center"
      >
        <IconPlus size={12} stroke={2.5} />
      </button>
    </div>
  );
}
