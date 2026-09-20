import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { FlyVerdict } from './FlyVerdict';
import {
  fetchForecastHistory, fetchHistoryCount, fetchScoreboard, fetchUpcomingPicks,
  type ForecastModel, type HistoryCursor, type HistoryRow, type Outcome,
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

const PAGE = 40;

/**
 * История прогнозов страницами, с фильтром по прогнозисту.
 *
 * ⚠️ РАССЧИТАНА НА ДЕСЯТКИ ТЫСЯЧ СТРОК. Каждый сыгранный матч добавляет по
 * строке на прогнозиста, то есть тысяча матчей — это три тысячи строк, и
 * дальше только больше. Поэтому здесь нет ни «загрузить всё», ни `offset`:
 * страница берётся КУРСОРОМ по последней показанной строке, и стоит она
 * одинаково что на первой сотне, что на десятитысячной.
 *
 * Уже показанное не перезапрашивается: новая страница добавляется к прежним.
 * Смена фильтра начинает с чистого листа — это другой список, а не другая его
 * часть.
 */
function useHistory(model: ForecastModel | null) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);

  // Фильтр сменился — список начинается заново.
  useEffect(() => {
    let dead = false;
    setRows([]); setDone(false); setBusy(true); setTotal(null);
    void fetchHistoryCount(model).then((s) => { if (!dead) setTotal(dataOr(s, null)); });
    void fetchForecastHistory(model, PAGE, null).then((s) => {
      if (dead) return;
      const got = dataOr(s, []);
      setRows(got); setDone(got.length < PAGE); setBusy(false);
    });
    return () => { dead = true; };
  }, [model]);

  const more = useCallback(() => {
    const last = rows[rows.length - 1];
    if (!last || busy || done) return;
    setBusy(true);
    const after: HistoryCursor = {
      commence_at: last.commence_at, fixture_id: last.fixture_id,
    };
    void fetchForecastHistory(model, PAGE, after).then((s) => {
      const got = dataOr(s, []);
      // ⚠️ ДОБАВЛЯЕМ, А НЕ ЗАМЕНЯЕМ, и это не мелочь: замена стирала бы всё
      // пролистанное, а курсор указывал бы в середину — список складывался бы
      // гармошкой при каждом нажатии.
      setRows((prev) => [...prev, ...got]);
      setDone(got.length < PAGE);
      setBusy(false);
    });
  }, [model, rows, busy, done]);

  return { rows, total, busy, done, more };
}

function dayLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}

export function WinnerBoard() {
  const { t, i18n } = useTranslation();
  const [board, setBoard] = useState<LoadState<Scoreboard[]>>(LOADING);
  const [soon, setSoon] = useState<LoadState<UpcomingPick[]>>(LOADING);
  const [only, setOnly] = useState<ForecastModel | null>(null);
  const [chosen, setChosen] = useState(0);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let dead = false;
    // Три запроса рядом, а не по очереди: ни один не зависит от другого, и
    // ожидание по самому медленному было бы ожиданием на пустом месте.
    void fetchScoreboard().then((s) => { if (!dead) setBoard(s); });
    void fetchUpcomingPicks(20).then((s) => { if (!dead) setSoon(s); });
    return () => { dead = true; };
  }, []);

  const rows = dataOr(board, []);
  const list = dataOr(soon, []);
  const past = useHistory(only);
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
        <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
          <span className="text-[11px] uppercase tracking-wider text-brand-muted">
            {t('duel.history')}
          </span>
          {past.total != null && past.rows.length > 0 && (
            <span className="text-[11px] text-brand-muted tabular-nums">
              {t('duel.history_shown', { n: past.rows.length, total: past.total })}
            </span>
          )}
        </div>

        {/* Фильтр по прогнозисту. При тысячах строк «показать всех вперемешку»
            перестаёт быть читаемым: вопрос почти всегда про одного. */}
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {([null, 'own', 'llm', 'fly'] as (ForecastModel | null)[]).map((m) => (
            <button
              key={m ?? 'all'}
              type="button"
              onClick={() => { hapticImpact('light'); setOnly(m); }}
              className={`rounded-full px-3 py-1 text-[11px] border transition-colors ${
                only === m
                  ? 'bg-white/15 border-white/25 text-white'
                  : 'bg-transparent border-white/10 text-brand-muted'
              } ${m ? TINT[m] : ''} ${only === m ? '' : 'opacity-80'}`}
            >
              {m ? t(`duel.model.${m}`) : t('duel.history_all')}
            </button>
          ))}
        </div>

        {past.rows.length === 0 ? (
          <p className="text-[12px] text-brand-muted px-1 py-2">
            {past.busy ? '…' : t('duel.no_history')}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <tbody>
                  {past.rows.map((h, i) => {
                    // Дата печатается один раз на день, а не в каждой строке:
                    // при сорока строках подряд повтор съедает колонку и ничего
                    // не добавляет.
                    const day = dayLabel(h.commence_at, i18n.language);
                    const first = i === 0
                      || dayLabel(past.rows[i - 1].commence_at, i18n.language) !== day;
                    return (
                      <tr
                        key={`${h.fixture_id}-${h.model}`}
                        className={`border-t border-white/5 ${
                          h.correct ? 'bg-emerald-400/[0.04]' : ''}`}
                      >
                        <td className="py-1.5 pr-2 align-top w-[3.2rem]">
                          <span className="text-[10px] text-brand-muted tabular-nums">
                            {first ? day : ''}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className="text-white">{h.home_team}</span>
                          <span className="text-brand-muted"> — </span>
                          <span className="text-brand-muted">{h.away_team}</span>
                          {h.backfilled && (
                            <span className="text-[9px] text-brand-muted/60 ml-1">
                              {t('duel.short.backfilled', { defaultValue: '↺' })}
                            </span>
                          )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pt-2 text-center">
              {past.done ? (
                <span className="text-[11px] text-brand-muted">{t('duel.history_end')}</span>
              ) : (
                <button
                  type="button"
                  disabled={past.busy}
                  onClick={() => { hapticImpact('light'); past.more(); }}
                  className="rounded-full px-4 py-1.5 text-[12px] border border-white/15
                             text-white bg-white/5 disabled:opacity-40"
                >
                  {past.busy ? '…' : t('duel.history_more')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
