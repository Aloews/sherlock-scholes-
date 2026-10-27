import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import type { CardCategory } from '@/shared/types/database';

type AwardKey = 'ballon_dor' | 'ballon_dor_feminin' | 'the_best' | 'the_best_female' | 'golden_boy' | 'golden_boot';
type AwardCandidate = {
  award_key: AwardKey; season_id: number; snapshot_date: string; card_id: string; competition_id: string;
  card_name: string; photo_url: string | null; category: CardCategory; position_ru: string | null;
  candidate_score: number; candidate_rank: number; confidence: 'low' | 'medium' | 'high'; data_coverage: number;
  score_components: Record<string, number>; evidence: Record<string, unknown>; model_version: string;
};
type TeamCandidate = {
  tournament: string; season_start: string; snapshot_date: string; team_key: string; team_name: string;
  candidate_score: number; candidate_rank: number; confidence: 'low' | 'medium' | 'high'; data_coverage: number;
  score_components: Record<string, number>; evidence: Record<string, unknown>; model_version: string;
};

const AWARDS: { value: AwardKey; label: string }[] = [
  { value: 'ballon_dor', label: 'Золотой мяч' },
  { value: 'ballon_dor_feminin', label: 'Золотой мяч — женщины' },
  { value: 'the_best', label: 'The Best' },
  { value: 'the_best_female', label: 'The Best — женщины' },
  { value: 'golden_boy', label: 'Golden Boy' },
  { value: 'golden_boot', label: 'Лучший бомбардир турнира' },
];
const confidenceLabel = (value: string) => value === 'high' ? 'Высокая' : value === 'medium' ? 'Средняя' : 'Низкая';
const panel = 'rounded-xl border border-brand-border bg-brand-surface p-3';
const selectClass = 'min-w-0 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-white';

export function CandidateAnalyticsPanel({ password }: { password: string }) {
  const [mode, setMode] = useState<'awards' | 'teams'>('awards');
  const [award, setAward] = useState<AwardKey>('ballon_dor');
  const [competition, setCompetition] = useState('');
  const [tournament, setTournament] = useState('');
  const [awards, setAwards] = useState<AwardCandidate[]>([]);
  const [teams, setTeams] = useState<TeamCandidate[]>([]);
  const [teamTournamentNames, setTeamTournamentNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshotDate, setSnapshotDate] = useState('');
  const requestId = useRef(0);

  const load = async (
    selectedAward: AwardKey = award,
    selectedCompetition: string = competition,
    selectedTournament: string = tournament,
  ) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [awardResult, teamSummaryResult, teamDetailResult] = await Promise.all([
        supabase.rpc('admin_list_award_candidates', {
          p_password: password,
          p_award_key: selectedAward,
          p_competition_id: selectedAward === 'golden_boot' && selectedCompetition.trim() ? selectedCompetition.trim() : null,
        }),
        supabase.rpc('admin_list_team_tournament_candidates', {
          p_password: password,
          p_tournament: null,
        }),
        selectedTournament
          ? supabase.rpc('admin_list_team_tournament_candidates', {
              p_password: password,
              p_tournament: selectedTournament,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (currentRequest !== requestId.current) return;
      if (awardResult.error) throw new Error(awardResult.error.message);
      if (teamSummaryResult.error) throw new Error(teamSummaryResult.error.message);
      if (teamDetailResult.error) throw new Error(teamDetailResult.error.message);
      const awardRows = (awardResult.data ?? []) as AwardCandidate[];
      const summaryRows = (teamSummaryResult.data ?? []) as TeamCandidate[];
      const detailRows = (teamDetailResult.data ?? []) as TeamCandidate[];
      const teamRows = selectedTournament ? detailRows : summaryRows;
      setAwards(awardRows);
      setTeams(teamRows);
      setTeamTournamentNames([...new Set(summaryRows.map((row) => row.tournament))].sort());
      const dates = [...awardRows.map((row) => row.snapshot_date), ...summaryRows.map((row) => row.snapshot_date)].sort();
      setSnapshotDate(dates[dates.length - 1] ?? '');
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  // Re-query the award when the selector changes. Tournament ID remains explicit:
  // the user can finish typing it and press Update rather than firing per keystroke.
  useEffect(() => { void load(award, competition, tournament); }, [award, tournament, password]); // eslint-disable-line react-hooks/exhaustive-deps

  const tournaments = teamTournamentNames;
  const shownTeams = useMemo(
    () => teams.filter((row) => !tournament || row.tournament === tournament),
    [teams, tournament],
  );

  return (
    <section className="space-y-3">
      <div className={panel + ' space-y-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Кандидаты на награды и победы</h2>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="rounded-lg bg-brand-accent px-3 py-2 text-xs font-medium text-brand-bg disabled:opacity-50">
            {loading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('awards')}
            className={'rounded-lg px-3 py-2 text-xs ' + (mode === 'awards' ? 'bg-brand-accent text-brand-bg' : 'bg-brand-bg text-white')}>
            Личные награды
          </button>
          <button type="button" onClick={() => setMode('teams')}
            className={'rounded-lg px-3 py-2 text-xs ' + (mode === 'teams' ? 'bg-brand-accent text-brand-bg' : 'bg-brand-bg text-white')}>
            Командные турниры
          </button>
        </div>
        {mode === 'awards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select aria-label="Награда" className={selectClass} value={award}
              onChange={(event) => setAward(event.target.value as AwardKey)}>
              {AWARDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {award === 'golden_boot' && (
              <input aria-label="ID турнира" className={selectClass} value={competition}
                onChange={(event) => setCompetition(event.target.value)}
                placeholder="ID турнира для точного списка" />
            )}
          </div>
        ) : (
          <select aria-label="Турнир" className={selectClass} value={tournament}
            onChange={(event) => setTournament(event.target.value)}>
            <option value="">Все турниры</option>
            {tournaments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        )}
        <p className="text-xs text-brand-muted">
          {snapshotDate ? 'Снимок данных: ' + snapshotDate + '. ' : ''}
          Баллы — сравнительный индекс, не вероятность победы. Уверенность учитывает доступность статистики.
        </p>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      </div>

      {mode === 'awards' && (
        <div className="space-y-2">
          {awards.length === 0 && !loading && !error && (
            <p className="text-sm text-brand-muted">Нет сезонной статистики для этой категории в подключённом источнике.</p>
          )}
          {awards.map((row) => (
            <article key={[row.award_key, row.season_id, row.snapshot_date, row.card_id, row.competition_id].join(':')}
              className={panel + ' flex items-start gap-3'}>
              <span className="w-7 shrink-0 pt-1 text-center text-sm font-semibold text-brand-accent">#{row.candidate_rank}</span>
              {row.photo_url
                ? <PlayerPhoto src={row.photo_url} category={row.category} className="h-10 w-10 rounded-full shrink-0" />
                : <span className="h-10 w-10 rounded-full bg-brand-border shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.card_name}</p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  Сезон {row.season_id} · год награды {String(row.evidence.target_award_year ?? row.season_id)}
                </p>
                {row.award_key === 'golden_boot' && (
                  <p className="truncate text-xs text-brand-muted">Турнир ID: {row.competition_id}</p>
                )}
                <p className="mt-1 text-xs text-brand-muted">
                  Голы {String(row.evidence.goals ?? '—')} · передачи {String(row.evidence.assists ?? '—')} · минуты {String(row.evidence.minutes ?? '—')}
                </p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  В выборке: {String(row.evidence.candidate_pool_size ?? '—')} · источник: {String(row.evidence.stats_source ?? '—')}
                </p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  Уверенность: {confidenceLabel(row.confidence)} · покрытие {Math.round(row.data_coverage * 100)}%
                  {row.score_components.sample_reliability != null
                    ? ' · надёжность выборки ' + Math.round(row.score_components.sample_reliability * 100) + '%'
                    : ''}
                </p>
                <details className="mt-1 text-[11px] text-brand-muted">
                  <summary className="cursor-pointer">Факторы оценки</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify({ components: row.score_components, evidence: row.evidence }, null, 2)}</pre>
                </details>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold">{Number(row.candidate_score).toFixed(1)}</p>
                <p className="text-[10px] text-brand-muted">индекс</p>
              </div>
            </article>
          ))}
        </div>
      )}

      {mode === 'teams' && (
        <div className="space-y-2">
          {shownTeams.length === 0 && !loading && !error && (
            <p className="text-sm text-brand-muted">Снимков команд пока нет. Они появятся после успешного обновления.</p>
          )}
          {shownTeams.map((row) => (
            <article key={[row.tournament, row.season_start, row.snapshot_date, row.team_key].join(':')}
              className={panel + ' flex items-start gap-3'}>
              <span className="w-7 shrink-0 pt-1 text-center text-sm font-semibold text-brand-accent">#{row.candidate_rank}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.team_name}</p>
                <p className="truncate text-xs text-brand-muted">{row.tournament}</p>
                <p className="mt-1 text-xs text-brand-muted">
                  Игр {String(row.evidence.matches_played ?? '—')} · очки/игру {String(row.evidence.points_per_game ?? '—')} · разница/игру {String(row.evidence.goal_difference_per_game ?? '—')}
                </p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  Последний результат: {String(row.evidence.latest_match_date ?? '—')}
                  {row.evidence.days_since_last_match != null
                    ? ' · ' + String(row.evidence.days_since_last_match) + ' дн. назад'
                    : ''}
                </p>
                <p className="mt-1 text-[11px] text-brand-muted">
                  Уверенность: {confidenceLabel(row.confidence)} · покрытие {Math.round(row.data_coverage * 100)}%
                </p>
                <details className="mt-1 text-[11px] text-brand-muted">
                  <summary className="cursor-pointer">Факторы оценки</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify(row.evidence, null, 2)}</pre>
                </details>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold">{Number(row.candidate_score).toFixed(1)}</p>
                <p className="text-[10px] text-brand-muted">индекс</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
