import { useEffect, useMemo, useState } from 'react';
import {
  adminListAwardCandidates,
  type PersonalAwardCandidate,
} from '@/features/admin/adminApi';

type AwardGroup = { key: string; rows: PersonalAwardCandidate[] };

const awardLabels: Record<string, string> = {
  ballon_dor: 'Золотой мяч',
  ballon_dor_feminin: 'Золотой мяч — женщины',
  the_best: 'The Best',
  the_best_female: 'The Best — женщины',
  golden_boy: 'Golden Boy',
  golden_boot: 'Золотая бутса',
};

function metric(evidence: Record<string, unknown>, key: string): string {
  const value = evidence[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const confidenceLabel: Record<PersonalAwardCandidate['confidence'], string> = {
  high: 'данные: высокая полнота',
  medium: 'данные: средняя полнота',
  low: 'данные: низкая полнота',
};

export function AwardCandidatePanel({ password }: { password: string }) {
  const [rows, setRows] = useState<PersonalAwardCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await adminListAwardCandidates(password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [password]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<AwardGroup[]>(() => {
    const grouped = new Map<string, PersonalAwardCandidate[]>();
    for (const row of rows) {
      const key = row.award_key;
      const current = grouped.get(key) ?? [];
      current.push(row);
      grouped.set(key, current);
    }
    return Array.from(grouped.entries())
      .map(([key, candidates]) => ({
        key,
        rows: candidates.sort((a, b) => a.candidate_rank - b.candidate_rank),
      }))
      .sort((a, b) => (awardLabels[a.key] ?? a.key).localeCompare(awardLabels[b.key] ?? b.key, 'ru'));
  }, [rows]);

  const snapshotDate = rows.reduce((latest, row) => row.snapshot_date > latest ? row.snapshot_date : latest, '');

  return (
    <section className="rounded-2xl border border-brand-border bg-brand-surface/50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Претенденты на личные награды</h2>
          <p className="text-[11px] text-brand-muted mt-1">
            Индекс 0–100 — не вероятность. Снимок: {snapshotDate || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-brand-border px-3 py-1.5 text-xs text-brand-muted disabled:opacity-50"
        >
          {loading ? '…' : 'Обновить'}
        </button>
      </div>

      {loading && <p className="text-xs text-brand-muted">Загрузка…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && groups.length === 0 && (
        <p className="text-xs text-brand-muted">Нет свежих снимков претендентов.</p>
      )}

      <div className="space-y-2">
        {groups.map((group, index) => {
          const leader = group.rows[0];
          return (
            <details
              key={group.key}
              open={index < 2}
              className="rounded-xl border border-brand-border bg-brand-surface/70"
            >
              <summary className="cursor-pointer list-none p-3 flex items-start gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-white">{awardLabels[group.key] ?? group.key}</span>
                  <span className="block text-[11px] text-brand-muted mt-1">
                    {leader?.season_id} · {group.rows.length} претендентов
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs text-brand-muted">№1</span>
                  <span className="block text-sm font-semibold text-brand-accent">{leader?.card_name ?? '—'}</span>
                  <span className="block text-[11px] text-brand-muted">индекс {leader?.candidate_score.toFixed(1) ?? '—'}</span>
                </span>
              </summary>
              <div className="border-t border-brand-border divide-y divide-brand-border">
                {group.rows.slice(0, 10).map((candidate) => {
                  const evidence = candidate.evidence ?? {};
                  const tone = candidate.confidence === 'high'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : candidate.confidence === 'medium'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-brand-border text-brand-muted';
                  return (
                    <div key={candidate.card_id} className="p-3 flex items-start gap-3">
                      <span className="w-6 shrink-0 text-xs text-brand-muted pt-0.5">#{candidate.candidate_rank}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white">{candidate.card_name}</span>
                          <span className={'text-[10px] rounded-full px-2 py-0.5 ' + tone}>
                            {confidenceLabel[candidate.confidence]}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-muted mt-1">
                          Голы {metric(evidence, 'goals')} · передачи {metric(evidence, 'assists')} · матчи {metric(evidence, 'appearances')} · минуты {metric(evidence, 'minutes')} · голы/90 {metric(evidence, 'goals_per_90')}
                          {evidence.age_on_snapshot !== null && evidence.age_on_snapshot !== undefined
                            ? ' · возраст ' + metric(evidence, 'age_on_snapshot')
                            : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums">{candidate.candidate_score.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
