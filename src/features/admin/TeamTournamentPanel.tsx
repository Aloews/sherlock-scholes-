import { useEffect, useMemo, useState } from 'react';
import {
  adminListTeamTournamentCandidates,
  type TeamTournamentCandidate,
} from '@/features/admin/adminApi';

type TournamentGroup = { name: string; rows: TeamTournamentCandidate[] };

function numberFrom(evidence: Record<string, unknown>, key: string): number | null {
  const value = evidence[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function signed(value: number | null): string {
  if (value === null) return '—';
  return (value > 0 ? '+' : '') + value.toFixed(2);
}

const confidenceLabel: Record<TeamTournamentCandidate['confidence'], string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

export function TeamTournamentPanel({ password }: { password: string }) {
  const [rows, setRows] = useState<TeamTournamentCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('all');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await adminListTeamTournamentCandidates(password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [password]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<TournamentGroup[]>(() => {
    const byTournament = new Map<string, TeamTournamentCandidate[]>();
    for (const row of rows) {
      const current = byTournament.get(row.tournament) ?? [];
      current.push(row);
      byTournament.set(row.tournament, current);
    }
    return Array.from(byTournament.entries())
      .map(([name, candidates]) => ({
        name,
        rows: candidates.sort((a, b) => a.candidate_rank - b.candidate_rank),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [rows]);

  const visibleGroups = selected === 'all' ? groups : groups.filter((group) => group.name === selected);
  const snapshotDate = rows.reduce((latest, row) => row.snapshot_date > latest ? row.snapshot_date : latest, '');

  return (
    <section className="rounded-2xl border border-brand-border bg-brand-surface/50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Претенденты на победу в турнирах</h2>
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

      <select
        aria-label="Выбрать турнир"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-sm text-white"
      >
        <option value="all">Все турниры ({groups.length})</option>
        {groups.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
      </select>

      {loading && <p className="text-xs text-brand-muted">Загрузка…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && groups.length === 0 && (
        <p className="text-xs text-brand-muted">Нет свежих снимков претендентов.</p>
      )}

      <div className="space-y-2">
        {visibleGroups.map((group, index) => {
          const leader = group.rows[0];
          return (
            <details
              key={group.name}
              open={selected !== 'all' || index < 2}
              className="rounded-xl border border-brand-border bg-brand-surface/70"
            >
              <summary className="cursor-pointer list-none p-3 flex items-start gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-white truncate">{group.name}</span>
                  <span className="block text-[11px] text-brand-muted mt-1">
                    {leader?.season_start} · {group.rows.length} команд
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs text-brand-muted">№1</span>
                  <span className="block text-sm font-semibold text-brand-accent">{leader?.team_name ?? '—'}</span>
                  <span className="block text-[11px] text-brand-muted">индекс {leader?.candidate_score.toFixed(1) ?? '—'}</span>
                </span>
              </summary>
              <div className="border-t border-brand-border divide-y divide-brand-border">
                {group.rows.slice(0, 10).map((candidate) => {
                  const evidence = candidate.evidence ?? {};
                  const matches = numberFrom(evidence, 'matches');
                  const wins = numberFrom(evidence, 'wins');
                  const draws = numberFrom(evidence, 'draws');
                  const losses = numberFrom(evidence, 'losses');
                  const points = numberFrom(evidence, 'points');
                  const gd = numberFrom(evidence, 'goal_difference_per_game');
                  const elo = numberFrom(evidence, 'elo');
                  const tone = candidate.confidence === 'high'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : candidate.confidence === 'medium'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-brand-border text-brand-muted';
                  return (
                    <div key={candidate.team_key} className="p-3 flex items-start gap-3">
                      <span className="w-6 shrink-0 text-xs text-brand-muted pt-0.5">#{candidate.candidate_rank}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white">{candidate.team_name}</span>
                          <span className={'text-[10px] rounded-full px-2 py-0.5 ' + tone}>
                            {confidenceLabel[candidate.confidence]}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-muted mt-1">
                          И {matches ?? '—'} · В-Д-П {wins ?? '—'}-{draws ?? '—'}-{losses ?? '—'} · очки {points ?? '—'} · РМ/матч {signed(gd)} · Elo {elo ?? '—'}
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
