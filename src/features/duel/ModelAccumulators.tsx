import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataOr } from '@/shared/lib/loadState';
import {
  fetchAccumulatorScore, fetchModelAccumulators,
  type AccumulatorScore, type ForecastModel, type ModelAccumulator,
} from './forecastApi';

/**
 * ЭКСПРЕССЫ, СОБРАННЫЕ ТРЕМЯ МОДЕЛЯМИ, И ИХ ИСТОРИЯ.
 *
 * Владелец: «нужно доделать экспрессы и их историю; три модели стоит обучить
 * на составлении удачных экспрессов, а не одиночных матчей».
 *
 * ⚠️ ЭТА ПАНЕЛЬ — НЕ ТА, ЧТО В /admin, И РАЗНИЦА ПРИНЦИПИАЛЬНА.
 * `AccumulatorPanel` собирает плечи из букмекерской линии и потому живёт
 * только за паролем персонала (§4.4 docs/LIVE_FOOTBALL_HANDOFF.md: игроку не
 * показывают ни коэффициентов, ни производных от них). Здесь плечи собраны из
 * СОБСТВЕННЫХ калиброванных вероятностей моделей: ни цены, ни выплаты, ни
 * ожидаемого возврата тут нет и быть не может. Граница §4.4 не сдвинута — она
 * просто не задета, и держится это фильтром в самих функциях базы
 * (`model is not null`), а не доверием к экрану.
 *
 * ⚠️ РЯДОМ С ДОЛЕЙ ПРОХОДОВ ВСЕГДА СТОИТ ОЖИДАНИЕ. «Прошло 30 %» само по себе
 * не значит ничего: вопрос всегда в том, сколько обещала калибровка. Экран,
 * показывающий факт без ожидания, читается как достижение независимо от того,
 * достижение это или провал.
 *
 * ⚠️ И ОТДЕЛЬНО ПОМЕЧЕНО ТО, ЧТО СОБРАНО ЗАДНИМ ЧИСЛОМ. У таких билетов есть
 * поддавки: калибровка, которой отбирались плечи, подогнана в том числе на
 * этих же матчах. Честное число даёт ход вперёд в
 * `football_scraper/accumulator_backtest.py`, и оно заметно скромнее.
 */

const TINT: Record<ForecastModel, string> = {
  own: 'text-brand-accent',
  llm: 'text-sky-300',
  fly: 'text-amber-300',
};

const PICK_RE = /\(([HDA])\)/g;

function pct(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

/** Строки вида «Хозяева – Гости (H)» → с переведённым исходом. */
function useTeams(teams: string | null): string {
  const { t } = useTranslation();
  if (!teams) return '';
  return teams.replace(PICK_RE, (_, o: string) => `(${t(`duel.pick.${o}`)})`);
}

function Ticket({ row }: { row: ModelAccumulator }) {
  const { t } = useTranslation();
  const teams = useTeams(row.teams);
  const state = row.settled_at == null
    ? { text: t('duel.acc.pending'), cls: 'text-brand-muted' }
    : row.won
      ? { text: t('duel.acc.won'), cls: 'text-emerald-300' }
      : { text: t('duel.acc.lost'), cls: 'text-rose-300' };

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className={`font-bold uppercase tracking-wider ${TINT[row.model]}`}>
          {t(`duel.model.${row.model}`)}
        </span>
        <span className="tabular-nums text-brand-muted">
          {t('duel.acc.legs', { count: row.legs })}
          {' · '}
          {t('duel.acc.chance', { v: (row.pass_prob * 100).toFixed(1) })}
        </span>
      </div>
      <div className="text-[12px] leading-snug">{teams}</div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px] tabular-nums">
        <span className={state.cls}>{state.text}</span>
        {row.settled_at != null && row.legs_won != null && (
          <span className="text-brand-muted">
            {t('duel.acc.legs_won', { n: row.legs_won, k: row.legs })}
          </span>
        )}
        {/* Задним числом — обязательно видно, а не сноской внизу. */}
        {row.backfilled && (
          <span className="text-brand-muted/70">{t('duel.acc.backfilled')}</span>
        )}
      </div>
    </div>
  );
}

export function ModelAccumulators() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ModelAccumulator[]>([]);
  const [score, setScore] = useState<AccumulatorScore[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let dead = false;
    void Promise.all([fetchModelAccumulators(null, 40), fetchAccumulatorScore()])
      .then(([h, s]) => {
        if (dead) return;
        setRows(dataOr(h, []));
        setScore(dataOr(s, []));
        setBusy(false);
      });
    return () => { dead = true; };
  }, []);

  const pending = rows.filter((r) => r.settled_at == null);
  const past = rows.filter((r) => r.settled_at != null);
  const anyBackfilled = score.some((s) => s.backfilled > 0);

  if (busy) return null;

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1">
        {t('duel.acc.title')}
      </div>

      {/* ── что собрано на ближайшие дни ── */}
      {pending.length > 0
        ? <div className="space-y-2">{pending.map((r) => <Ticket key={r.id} row={r} />)}</div>
        : <div className="text-[12px] text-brand-muted px-1">{t('duel.acc.none')}</div>}

      {/* ── сколько проходило ── */}
      {score.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-brand-muted">
            {t('duel.acc.board')}
          </div>
          {score.map((s) => (
            <div key={`${s.model}:${s.legs}`}
                 className="flex items-baseline justify-between gap-3 text-[11px] tabular-nums">
              <span className={`font-bold ${TINT[s.model]}`}>
                {t(`duel.model.${s.model}`)} · {t('duel.acc.legs', { count: s.legs })}
              </span>
              <span>
                {t('duel.acc.hit', { v: pct(s.hit_rate) })}
                <span className="text-brand-muted">
                  {' · '}{t('duel.acc.expected', { v: pct(s.expected) })}
                  {' · '}{t('duel.acc.settled', { n: s.settled })}
                </span>
              </span>
            </div>
          ))}
          {/*
            ⚠️ ОГОВОРКА СТОИТ ПОД ЧИСЛАМИ, А НЕ В КОНЦЕ ЭКРАНА. Пока вся
            история собрана задним числом, доля проходов завышена, и молчать
            об этом значит показывать красивое число как заслугу.
          */}
          {anyBackfilled && (
            <div className="text-[10px] leading-snug text-brand-muted/80 pt-1">
              {t('duel.acc.caveat')}
            </div>
          )}
        </div>
      )}

      {/* ── история ── */}
      {past.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1">
            {t('duel.acc.history')}
          </div>
          {past.slice(0, 20).map((r) => <Ticket key={r.id} row={r} />)}
        </div>
      )}
    </div>
  );
}
