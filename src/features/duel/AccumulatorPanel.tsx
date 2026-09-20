import { useEffect, useState } from 'react';
import { dataOr } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import {
  accumulatorMath, fetchAccumulator, type AccumulatorLeg,
} from './forecastApi';

/**
 * ЭКСПРЕСС ДЛЯ АДМИНА — с честной арифметикой, а не с советом.
 *
 * ⚠️ §4.4 docs/LIVE_FOOTBALL_HANDOFF.md: игроку не показывают ни
 * коэффициентов, ни производных. Эта панель живёт ТОЛЬКО в /admin за паролем
 * персонала; в игровые экраны её импортировать нельзя.
 *
 * ⚠️ ЧТО ЗДЕСЬ СЧИТАЕТСЯ И ПОЧЕМУ ИМЕННО ТАК. Вероятность берётся у рынка, а
 * не у наших моделей: их `confidence` — это отрыв первого варианта от
 * второго, и в их же коде записано, что вероятностью он не является.
 * Перемножать такое в экспрессе значило бы строить ожидание на числе, которое
 * ничего не измеряет.
 *
 * Модели стоят рядом отдельной колонкой: совпали они с рынком или нет. Это
 * повод посмотреть на матч, а не поправка к цене — расхождение всех трёх с
 * рынком чаще означает дырку в наших данных, чем находку.
 *
 * ⚠️ ВОЗВРАТ ПОКАЗЫВАЕТСЯ ВСЕГДА, И ОН ВСЕГДА МЕНЬШЕ ЕДИНИЦЫ. Это не
 * настроение, а устройство линии: вероятности очищены от маржи, выплата — нет.
 * Экран, который показывает проходимость и прячет возврат, читается как
 * «шансы хорошие» — а хорошие шансы и выгодная ставка это разные вещи, и
 * длинный экспресс ухудшает обе сразу.
 */

const PICK_RU: Record<string, string> = { H: 'П1', D: 'Х', A: 'П2' };

export function AccumulatorPanel({ password }: { password: string }) {
  const [legs, setLegs] = useState(4);
  const [minProb, setMinProb] = useState(0.6);
  const [rows, setRows] = useState<AccumulatorLeg[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setBusy(true); setErr(null);
    void fetchAccumulator(password, legs, minProb, 72).then((s) => {
      if (dead) return;
      const got = dataOr(s, []);
      setRows(got);
      setErr(s.status === 'error' ? 'не удалось загрузить' : null);
      setBusy(false);
    });
    return () => { dead = true; };
  }, [password, legs, minProb]);

  const math = accumulatorMath(rows);
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-brand-muted">
          Экспресс — ближайшие 72 часа
        </div>

        <div className="flex flex-wrap gap-3 text-[12px]">
          <label className="flex items-center gap-2">
            <span className="text-brand-muted">Ног</span>
            <select
              value={legs}
              onChange={(e) => { hapticImpact('light'); setLegs(Number(e.target.value)); }}
              className="bg-brand-bg border border-white/15 rounded px-2 py-1 text-white"
            >
              {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-brand-muted">Порог ноги</span>
            <select
              value={minProb}
              onChange={(e) => { hapticImpact('light'); setMinProb(Number(e.target.value)); }}
              className="bg-brand-bg border border-white/15 rounded px-2 py-1 text-white"
            >
              {[0.5, 0.6, 0.7, 0.8, 0.85].map((n) => (
                <option key={n} value={n}>{(n * 100).toFixed(0)}%</option>
              ))}
            </select>
          </label>
        </div>

        {busy && <p className="text-[12px] text-brand-muted">…</p>}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {!busy && !err && rows.length === 0 && (
          <p className="text-[12px] text-brand-muted">
            Нет матчей с таким порогом. Понизьте порог или подождите сбора котировок.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-brand-muted">
                  <tr>
                    <th className="text-left font-normal pb-1">Матч</th>
                    <th className="px-1 font-normal pb-1">Исход</th>
                    <th className="px-1 font-normal pb-1">Коэф.</th>
                    <th className="px-1 font-normal pb-1">Вер.</th>
                    <th className="pl-1 font-normal pb-1">Модели</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.fixture_id} className="border-t border-white/5">
                      <td className="py-1.5 pr-2">
                        <div className="text-white leading-tight">{l.home_team}</div>
                        <div className="text-brand-muted leading-tight">{l.away_team}</div>
                      </td>
                      <td className="py-1.5 px-1 text-center font-bold text-white">
                        {PICK_RU[l.pick] ?? l.pick}
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums text-brand-muted">
                        {l.price.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-1 text-center tabular-nums text-white">
                        {fmtPct(l.fair_prob)}
                      </td>
                      <td className="py-1.5 pl-1 text-center tabular-nums">
                        {/* Сколько наших согласны с рынком. Три из трёх — не
                            гарантия, ноль из трёх — повод проверить данные. */}
                        <span className={l.models_agree >= 2 ? 'text-emerald-400' : 'text-brand-muted'}>
                          {l.models_agree}/3
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl bg-black/20 border border-white/10 p-3 space-y-1.5">
              <div className="flex justify-between text-[12px]">
                <span className="text-brand-muted">Проходимость</span>
                <span className="text-white font-bold tabular-nums">{fmtPct(math.passRate)}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-brand-muted">Выплата</span>
                <span className="text-white tabular-nums">×{math.payout.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-brand-muted">Ожидаемый возврат</span>
                <span className={`font-bold tabular-nums ${
                  math.expectedReturn >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {math.expectedReturn.toFixed(3)}
                </span>
              </div>
              <p className="text-[11px] text-brand-muted leading-relaxed pt-1">
                Возврат меньше единицы — это маржа букмекера, а не ошибка счёта.
                Вероятности очищены от неё, выплата нет. Каждая добавленная нога
                ухудшает и проходимость, и возврат: маржа перемножается.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
