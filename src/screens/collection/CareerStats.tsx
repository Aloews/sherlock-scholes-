import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import {
  fetchCareerTotals, fetchClubCareer, fetchCurrentSeasonCompetitionStats,
  type CareerTotalsRow, type ClubCareerRow, type SeasonCompetitionRow,
} from '@/features/ratings/ratingsApi';

export function CareerStats({ cardId }: { cardId: string }) {
  const { t, i18n } = useTranslation();
  const [totals, setTotals] = useState<LoadState<CareerTotalsRow[]>>(LOADING);
  const [clubs, setClubs] = useState<LoadState<ClubCareerRow[]>>(LOADING);
  const [season, setSeason] = useState<LoadState<SeasonCompetitionRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setTotals(LOADING);
    setClubs(LOADING);
    setSeason(LOADING);
    void fetchCurrentSeasonCompetitionStats(cardId).then((result) => {
      if (!cancelled) setSeason(result);
    });
    void fetchCareerTotals(cardId).then((result) => {
      if (!cancelled) setTotals(result);
    });
    void fetchClubCareer(cardId).then((result) => {
      if (!cancelled) setClubs(result);
    });
    return () => { cancelled = true; };
  }, [cardId]);

  const total = totals.status === 'ok' ? totals.data[0] ?? null : null;
  const rows = clubs.status === 'ok' ? clubs.data : [];
  const seasonRows = season.status === 'ok' ? season.data : [];
  const seasonStartYear = new Date().getUTCMonth() >= 6
    ? new Date().getUTCFullYear()
    : new Date().getUTCFullYear() - 1;
  const seasonLabelCurrent = `${seasonStartYear}/${String(seasonStartYear + 1).slice(-2)}`;
  const loading = totals.status === 'loading' || clubs.status === 'loading' || season.status === 'loading';

  if (!total && rows.length === 0 && seasonRows.length === 0) {
    if (loading) {
      return (
        <div className="grid grid-cols-2 gap-2" aria-label={t('digest.loading')}>
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[68px] rounded-2xl border border-brand-border bg-brand-surface animate-pulse" />
          ))}
        </div>
      );
    }
    return null;
  }

  const number = new Intl.NumberFormat(i18n.language);
  const maxMinutes = Math.max(1, ...rows.map((row) => row.minutes));
  const ru = i18n.language.startsWith('ru');
  const seasonLabel = (row: ClubCareerRow): string | null => row.season_from == null || row.season_to == null
    ? null
    : row.season_from === row.season_to
      ? String(row.season_from)
      : `${row.season_from}–${row.season_to}`;

  return (
    <div className="space-y-3">
      {total && total.club_apps > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label={t('career.matches')} value={number.format(total.club_apps)} />
          <Tile label={t('career.goals')} value={number.format(total.club_goals)} accent />
          <Tile label={t('career.assists')} value={number.format(total.club_assists)} />
          <Tile label={t('career.minutes')} value={number.format(total.club_minutes)} />
        </div>
      )}

      {seasonRows.length > 0 && (
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-muted">
              {ru ? 'Текущий сезон' : 'Current season'}
            </p>
            <span className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white">
              {seasonLabelCurrent}
            </span>
          </div>
          <div className="space-y-2">
            {seasonRows.map((row) => (
              <div key={`${row.season_id}-${row.competition_id}`} className="flex items-center justify-between gap-3 rounded-xl bg-brand-bg px-3 py-2">
                <span className="min-w-0 truncate text-[12px] font-semibold text-white">{row.tournament}</span>
                <div className="flex shrink-0 gap-3 text-[10px] text-brand-muted tabular-nums">
                  <span>{number.format(row.appearances)} {ru ? 'матчей' : 'apps'}</span>
                  <span className="font-semibold text-brand-accent">{number.format(row.goals)} {ru ? 'голов' : 'goals'}</span>
                  <span>{number.format(row.assists)} {ru ? 'ассистов' : 'assists'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {total?.national_team && total.national_apps > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-surface px-3.5 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-accent" aria-hidden="true">
            <span className="text-base">◎</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-brand-muted">
              {t('career.national', { team: total.national_team, apps: total.national_apps, goals: total.national_goals })}
            </p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-muted">
              {ru ? 'Путь по клубам' : 'Club journey'}
            </p>
            <span className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white">
              {rows.length} {ru ? 'клубов' : 'clubs'}
            </span>
          </div>
          <ol className="space-y-0">
            {rows.map((row, index) => {
              const share = Math.max(3, Math.round((row.minutes / maxMinutes) * 100));
              return (
                <li key={row.club_id} className="relative flex gap-3">
                  <div className="flex w-5 shrink-0 flex-col items-center">
                    <span className={`z-[1] mt-1.5 h-2.5 w-2.5 rounded-full border-2 ${index === 0 ? 'border-brand-accent bg-brand-accent' : 'border-brand-muted/70 bg-brand-surface'}`} />
                    {index < rows.length - 1 && <span className="w-px flex-1 bg-brand-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`truncate text-[13px] font-semibold ${index === 0 ? 'text-white' : 'text-white/90'}`}>{row.club_name}</p>
                        {seasonLabel(row) && <p className="mt-0.5 text-[10px] text-brand-muted tabular-nums">{seasonLabel(row)}</p>}
                      </div>
                      {index === 0 && (
                        <span className="shrink-0 rounded-full bg-brand-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-accent">
                          {ru ? 'Последний' : 'Latest'}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-bg">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-accent/50 to-brand-accent" style={{ width: `${share}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-brand-muted">
                      <span><strong className="font-semibold text-white/90 tabular-nums">{number.format(row.apps)}</strong> {ru ? 'матчей' : 'apps'}</span>
                      <span><strong className="font-semibold text-brand-accent tabular-nums">{number.format(row.goals)}</strong> {ru ? 'голов' : 'goals'}</span>
                      <span><strong className="font-semibold text-white/90 tabular-nums">{number.format(row.assists)}</strong> {ru ? 'ассистов' : 'assists'}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent = false }: {
  label: string; value: string; accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface p-3">
      <p className={`ds-display text-xl font-extrabold leading-none tabular-nums ${accent ? 'text-brand-accent' : 'text-white'}`}>{value}</p>
      <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-brand-muted">{label}</p>
    </div>
  );
}
