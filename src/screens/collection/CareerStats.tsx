import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBallFootball, IconClock, IconTargetArrow, IconRun } from '@tabler/icons-react';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import {
  fetchCareerTotals, fetchClubCareer,
  type CareerTotalsRow, type ClubCareerRow,
} from '@/features/ratings/ratingsApi';

export function CareerStats({ cardId }: { cardId: string }) {
  const { t, i18n } = useTranslation();
  const [totals, setTotals] = useState<LoadState<CareerTotalsRow[]>>(LOADING);
  const [clubs, setClubs] = useState<LoadState<ClubCareerRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setTotals(LOADING);
    setClubs(LOADING);
    void fetchCareerTotals(cardId).then((r) => { if (!cancelled) setTotals(r); });
    void fetchClubCareer(cardId).then((r) => { if (!cancelled) setClubs(r); });
    return () => { cancelled = true; };
  }, [cardId]);

  const total = totals.status === 'ok' ? totals.data[0] ?? null : null;
  const rows = clubs.status === 'ok' ? clubs.data : [];
  const hasTotals = Boolean(total && total.club_apps > 0);

  if (!hasTotals && rows.length === 0) {
    if (totals.status === 'loading' || clubs.status === 'loading') {
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

  const n = new Intl.NumberFormat(i18n.language);
  const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));
  const compact = (value: number) => n.format(value);
  const seasonLabel = (row: ClubCareerRow) => row.season_from === row.season_to
    ? String(row.season_from)
    : `${row.season_from}–${row.season_to}`;

  return (
    <div className="space-y-4">
      {hasTotals && total && (
        <div className="grid grid-cols-2 gap-2">
          <StatTile icon={<IconBallFootball size={17} />} label={t('career.matches')} value={compact(total.club_apps)} />
          <StatTile icon={<IconTargetArrow size={17} />} label={t('career.goals')} value={compact(total.club_goals)} accent />
          <StatTile icon={<IconRun size={17} />} label={t('career.assists')} value={compact(total.club_assists)} />
          <StatTile icon={<IconClock size={17} />} label={t('career.minutes')} value={compact(total.club_minutes)} />
        </div>
      )}

      {total?.national_team && total.national_apps > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-surface px-3.5 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-bg text-brand-accent">
            <IconBallFootball size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-brand-muted">
              {i18n.language.startsWith('ru') ? 'Национальная сборная' : 'National team'}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{total.national_team}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums text-white">{compact(total.national_apps)}</p>
            <p className="text-[9px] text-brand-muted">{i18n.language.startsWith('ru') ? 'матчей' : 'apps'}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums text-brand-accent">{compact(total.national_goals)}</p>
            <p className="text-[9px] text-brand-muted">{i18n.language.startsWith('ru') ? 'голов' : 'goals'}</p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-muted">
                {i18n.language.startsWith('ru') ? 'Путь по клубам' : 'Club journey'}
              </p>
              <p className="mt-1 text-[11px] text-brand-muted/80">
                {i18n.language.startsWith('ru') ? 'От последнего клуба к первому' : 'Most recent club first'}
              </p>
            </div>
            <span className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white">
              {rows.length} {i18n.language.startsWith('ru') ? 'клубов' : 'clubs'}
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
                        <p className="mt-0.5 text-[10px] text-brand-muted tabular-nums">{seasonLabel(row)}</p>
                      </div>
                      {index === 0 && (
                        <span className="shrink-0 rounded-full bg-brand-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-accent">
                          {i18n.language.startsWith('ru') ? 'Последний' : 'Latest'}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-bg">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-accent/50 to-brand-accent" style={{ width: `${share}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-brand-muted">
                      <span><strong className="font-semibold text-white/90 tabular-nums">{compact(row.apps)}</strong> {i18n.language.startsWith('ru') ? 'матчей' : 'apps'}</span>
                      <span><strong className="font-semibold text-brand-accent tabular-nums">{compact(row.goals)}</strong> {i18n.language.startsWith('ru') ? 'голов' : 'goals'}</span>
                      <span><strong className="font-semibold text-white/90 tabular-nums">{compact(row.assists)}</strong> {i18n.language.startsWith('ru') ? 'ассистов' : 'assists'}</span>
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

function StatTile({ icon, label, value, accent = false }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface p-3">
      <div className={`absolute right-3 top-3 ${accent ? 'text-brand-accent' : 'text-brand-muted'}`}>{icon}</div>
      <p className={`ds-display text-xl font-extrabold leading-none tabular-nums ${accent ? 'text-brand-accent' : 'text-white'}`}>{value}</p>
      <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-brand-muted">{label}</p>
    </div>
  );
}
