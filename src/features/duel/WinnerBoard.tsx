import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { FlyVerdict } from './FlyVerdict';
import {
  fetchForecastHistory, fetchScoreboard, fetchUpcomingPicks,
  type ForecastModel, type HistoryRow, type Outcome,
  type Scoreboard, type UpcomingPick,
} from './forecastApi';

/**
 * КТО ПОБЕДИТ — три прогнозиста, их история и муха, садящаяся на ответ.
 *
 * ⚠️ ТРИ ЧИСЛА РЯДОМ, А НЕ ОДНО. «Доля угаданных» за всё время прячет то, что
 * интересно на самом деле: учится модель или сыпется. Поэтому рядом всегда
 * стоят последние 30 матчей и серия — по ним видно направление, а не только
 * средний итог.
 *
 * ⚠️ СТРОКИ, СДЕЛАННЫЕ ЗАДНИМ ЧИСЛОМ, ПОМЕЧЕНЫ. Первые сотни прогнозов
 * получены прогоном по уже сыгранным матчам тестовой части — той, которую
 * модели не видели при подгонке. Утечки там нет, но «назвал до матча» и
 * «назвал задним числом» — разные вещи, и экран их не путает.
 */

const TINT: Record<ForecastModel, string> = {
  own: 'text-brand-accent',
  llm: 'text-sky-300',
  fly: 'text-amber-300',
};

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}

function PickChip({ pick, tint }: { pick: Outcome | null; tint: string }) {
  const { t } = useTranslation();
  if (!pick) return <span className="text-brand-muted/50">—</span>;
  return <span className={`font-bold ${tint}`}>{t(`duel.pick.${pick}`)}</span>;
}

export function WinnerBoard() {
  const { t } = useTranslation();
  const [board, setBoard] = useState<LoadState<Scoreboard[]>>(LOADING);
  const [soon, setSoon] = useState<LoadState<UpcomingPick[]>>(LOADING);
  const [past, setPast] = useState<LoadState<HistoryRow[]>>(LOADING);
  const [chosen, setChosen] = useState(0);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let dead = false;
    // Три запроса рядом, а не по очереди: ни один не зависит от другого, и
    // ожидание по самому медленному было бы ожиданием на пустом месте.
    void fetchScoreboard().then((s) => { if (!dead) setBoard(s); });
    void fetchUpcomingPicks(20).then((s) => { if (!dead) setSoon(s); });
    void fetchForecastHistory(null, 30).then((s) => { if (!dead) setPast(s); });
    return () => { dead = true; };
  }, []);

  const rows = dataOr(board, []);
  const list = dataOr(soon, []);
  const history = dataOr(past, []);
  const match = list[Math.min(chosen, Math.max(0, list.length - 1))];
  const dopamine = rows.find((r) => r.model === 'fly')?.dopamine ?? 0;

  return (
    <div className="space-y-4">
      {/* ── муха над ближайшим матчем ── */}
      {match && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-brand-muted">
              {t('duel.fly_verdict')}
            </span>
            <button
              type="button"
              className="text-[11px] text-brand-muted underline decoration-dotted"
              onClick={() => { hapticImpact('light'); setReplay((n) => n + 1); }}
            >
              {t('duel.fly_again')}
            </button>
          </div>

          <FlyVerdict
            home={match.home_team}
            away={match.away_team}
            pick={match.fly_pick}
            confidence={match.fly_conf}
            replayKey={replay}
          />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-muted tabular-nums pt-1">
            <span>{t('duel.fly_dopamine', { n: dopamine })}</span>
            {match.exp_total != null && (
              <span>{t('duel.exp_total', { v: match.exp_total.toFixed(1) })}</span>
            )}
            {match.agree != null && (
              <span>{t('duel.agree', { n: match.agree })}</span>
            )}
          </div>
        </div>
      )}

      {/* ── итог по каждому прогнозисту ── */}
      {rows.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1">
            {t('duel.board')}
          </div>
          {rows.map((r) => (
            <div key={r.model} className="flex items-baseline justify-between gap-3 px-1">
              <div className="min-w-0">
                <span className={`font-bold ${TINT[r.model]}`}>{t(`duel.model.${r.model}`)}</span>
                <span className="text-[11px] text-brand-muted ml-2">
                  {t('duel.graded', { n: r.graded })}
                </span>
              </div>
              <div className="shrink-0 tabular-nums text-right">
                <span className="text-white font-black">{pct(r.accuracy)}</span>
                <span className="text-[11px] text-brand-muted ml-2">
                  {t('duel.last30', { v: pct(r.last30) })}
                </span>
                {r.streak > 1 && (
                  <span className="text-[11px] text-emerald-400 ml-2">
                    {t('duel.streak', { n: r.streak })}
                  </span>
                )}
              </div>
            </div>
          ))}
          {rows.some((r) => r.backfilled > 0) && (
            <p className="text-[11px] text-brand-muted leading-relaxed px-1 pt-1">
              {t('duel.backfilled_note')}
            </p>
          )}
        </div>
      )}

      {/* ── ближайшие матчи ── */}
      <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
        <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1 pb-1">
          {t('duel.upcoming')}
        </div>
        {list.length === 0 ? (
          <p className="text-[12px] text-brand-muted px-1 py-2">{t('duel.no_upcoming')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-brand-muted">
                <tr>
                  <th className="text-left font-normal pb-1">{t('duel.col_match')}</th>
                  <th className="px-1 font-normal pb-1 text-brand-accent">{t('duel.short.own')}</th>
                  <th className="px-1 font-normal pb-1 text-sky-300">{t('duel.short.llm')}</th>
                  <th className="pl-1 font-normal pb-1 text-amber-300">{t('duel.short.fly')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m, i) => (
                  <tr
                    key={m.fixture_id}
                    className={`border-t border-white/5 cursor-pointer ${
                      i === chosen ? 'bg-white/5' : ''}`}
                    onClick={() => { hapticImpact('light'); setChosen(i); setReplay((n) => n + 1); }}
                  >
                    <td className="py-2 pr-2">
                      <div className="text-white leading-tight truncate max-w-[10rem]">
                        {m.home_team}
                      </div>
                      <div className="text-brand-muted leading-tight truncate max-w-[10rem]">
                        {m.away_team}
                      </div>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <PickChip pick={m.own_pick} tint={TINT.own} />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <PickChip pick={m.llm_pick} tint={TINT.llm} />
                    </td>
                    <td className="py-2 pl-1 text-center">
                      <PickChip pick={m.fly_pick} tint={TINT.fly} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── история: что назвали и чем кончилось ── */}
      <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
        <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1 pb-1">
          {t('duel.history')}
        </div>
        {history.length === 0 ? (
          <p className="text-[12px] text-brand-muted px-1 py-2">{t('duel.no_history')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <tbody>
                {history.map((h) => (
                  <tr key={`${h.fixture_id}-${h.model}`} className="border-t border-white/5">
                    <td className="py-1.5 pr-2">
                      <span className="text-white truncate">{h.home_team}</span>
                      <span className="text-brand-muted"> — </span>
                      <span className="text-brand-muted truncate">{h.away_team}</span>
                    </td>
                    <td className={`py-1.5 px-1 text-center ${TINT[h.model]}`}>
                      {t(`duel.short.${h.model}`)}
                    </td>
                    <td className="py-1.5 px-1 text-center">
                      <PickChip pick={h.pick} tint={TINT[h.model]} />
                    </td>
                    <td className="py-1.5 px-1 text-center text-brand-muted">
                      {h.actual ? t(`duel.pick.${h.actual}`) : '—'}
                    </td>
                    <td className="py-1.5 pl-1 text-center">
                      {h.correct == null
                        ? <span className="text-brand-muted/60">—</span>
                        : <span className={h.correct ? 'text-emerald-400' : 'text-rose-400'}>
                            {h.correct ? '✓' : '✗'}
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
