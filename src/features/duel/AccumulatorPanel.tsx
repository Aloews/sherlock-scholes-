import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataOr } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { shortDateFormat, timeFormat } from '@/shared/lib/dateFormat';
import {
  accumulatorMath, fetchAccumulator, type AccumulatorLeg,
} from './forecastApi';
import {
  resolveAccumulatorWindow, windowLabel, WINDOW_HOURS,
} from './accumulatorWindow';

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
 *
 * ⚠️ ОКНО БЫЛО ПРИБИТО К 72 ЧАСАМ, И ПАНЕЛЬ ВРАЛА О ПРИЧИНЕ ПУСТОТЫ. Она
 * писала «понизьте порог», хотя порог был ни при чём: замер 21.09.2026 —
 * в ближайшие 14 суток 71 матч и НИ ОДНОГО с котировками, а все 77 матчей с
 * котировками начинаются 9 октября. Котировки покупаются по десяти клубным
 * лигам (бюджет в 500 кредитов, разбор в `supabase/functions/football-odds`),
 * а ближайшие две недели заняты сборными, МЛС и Аргентиной. Совет «понизьте
 * порог» в такой день не помогает НИКАК: понижай хоть до нуля — матчей в окне
 * нет вовсе.
 *
 * Отсюда три правки. Первая: окно выбирается, вплоть до месяца. Вторая: если
 * в выбранном окне пусто, панель сама идёт шире и ГОВОРИТ, что сделала, —
 * молча показать матчи через три недели там, где просили три дня, значило бы
 * соврать второй раз. Третья: причина пустоты теперь различается замером, а
 * не угадывается. Панель отдельно спрашивает то же окно с нулевым порогом:
 * вернулись матчи — виноват порог, и тогда видно, какой лучший; не вернулись
 * — виновато окно, и про порог не говорится ни слова.
 */

const PICK_RU: Record<string, string> = { H: 'П1', D: 'Х', A: 'П2' };

/** Почему пусто. Не мнение, а результат отдельного запроса. */
type Empty =
  | { kind: 'floor'; best: number }   // матчи есть, но все ниже порога
  | { kind: 'window' }                // матчей с котировками нет вовсе
  | null;

export function AccumulatorPanel({ password }: { password: string }) {
  const { i18n } = useTranslation();
  const [legs, setLegs] = useState(4);
  const [minProb, setMinProb] = useState(0.6);
  const [hours, setHours] = useState(72);
  const [rows, setRows] = useState<AccumulatorLeg[]>([]);
  const [usedHours, setUsedHours] = useState(72);
  const [empty, setEmpty] = useState<Empty>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setBusy(true); setErr(null); setEmpty(null);

    // ⚠️ ПОИСК ОКНА ЖИВЁТ В `accumulatorWindow.ts`, А НЕ ЗДЕСЬ, И ЭТО НЕ
    // вкусовщина: у него четыре разных исхода, три из которых на живых данных
    // встречаются раз в месяц. В компоненте их не проверить, в чистой функции
    // — проверяются все четыре (`accumulatorWindow.test.ts`).
    void (async () => {
      const out = await resolveAccumulatorWindow<AccumulatorLeg>(
        hours, minProb,
        async (h, floor) => {
          const s = await fetchAccumulator(password, legs, floor, h);
          return s.status === 'error' ? null : dataOr(s, []);
        },
      );
      if (dead) return;

      if (out.kind === 'error') {
        setErr('не удалось загрузить'); setRows([]); setBusy(false); return;
      }
      if (out.kind === 'rows') {
        setRows(out.rows); setUsedHours(out.hours); setEmpty(null); setBusy(false); return;
      }
      setRows([]);
      setUsedHours(out.hours);
      setEmpty(out.kind === 'floor' ? { kind: 'floor', best: out.best } : { kind: 'window' });
      setBusy(false);
    })();

    return () => { dead = true; };
  }, [password, legs, minProb, hours]);

  const math = accumulatorMath(rows);
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const day = shortDateFormat(i18n.language);
  const clock = timeFormat(i18n.language);
  const widened = rows.length > 0 && usedHours !== hours;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-brand-muted">
          Экспресс — матчи с котировками
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
              {[0.4, 0.5, 0.6, 0.7, 0.8, 0.85].map((n) => (
                <option key={n} value={n}>{(n * 100).toFixed(0)}%</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-brand-muted">Матчи ближайшие</span>
            <select
              value={hours}
              onChange={(e) => { hapticImpact('light'); setHours(Number(e.target.value)); }}
              className="bg-brand-bg border border-white/15 rounded px-2 py-1 text-white"
            >
              {WINDOW_HOURS.map((h) => (
                <option key={h} value={h}>{windowLabel(h)}</option>
              ))}
            </select>
          </label>
        </div>

        {busy && <p className="text-[12px] text-brand-muted">…</p>}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}

        {/* Расширили окно сами — говорим об этом. Иначе матч через три недели
            выглядел бы как матч послезавтра. */}
        {!busy && !err && widened && (
          <p className="text-[12px] text-amber-300/90 leading-relaxed">
            За «{windowLabel(hours)}» матчей с котировками нет — показываю ближайший
            {' '}«{windowLabel(usedHours)}». Даты каждого матча — в таблице.
          </p>
        )}

        {!busy && !err && empty?.kind === 'floor' && (
          <p className="text-[12px] text-brand-muted leading-relaxed">
            Матчи с котировками есть, но ни один не дотягивает до порога
            {' '}{(minProb * 100).toFixed(0)}%: лучший — {fmtPct(empty.best)}.
            Понизьте порог.
          </p>
        )}

        {!busy && !err && empty?.kind === 'window' && (
          <p className="text-[12px] text-brand-muted leading-relaxed">
            За «{windowLabel(usedHours)}» нет ни одного матча с котировками — дело
            НЕ в пороге, понижать его бесполезно. Котировки покупаются по
            десяти клубным лигам (АПЛ, Ла Лига, Серия А, Бундеслига, Лига 1,
            РПЛ, Эредивизи, Примейра, ЛЧ, ЛЕ); когда у них перерыв на сборные,
            в ближайшие дни нет ничего, а линия появляется к возобновлению
            туров.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-brand-muted">
                  <tr>
                    <th className="text-left font-normal pb-1">Когда</th>
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
                      {/* ⚠️ ДАТА — НЕ УКРАШЕНИЕ. Отбор идёт по вероятности, а не
                          по близости, поэтому в одном экспрессе легко
                          оказываются матчи с разницей в три недели. Без даты
                          это читалось бы как «ближайшие». */}
                      <td className="py-1.5 pr-2 whitespace-nowrap text-brand-muted tabular-nums">
                        <div className="leading-tight">{day.format(new Date(l.commence_at))}</div>
                        <div className="leading-tight">{clock.format(new Date(l.commence_at))}</div>
                      </td>
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
