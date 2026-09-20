import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import {
  fetchDuelModels, fetchDuelMatches,
  type DuelRow, type DuelMatch, type DuelModel,
} from '@/features/duel/duelApi';

/**
 * КТО ЛУЧШЕ ПРЕДСКАЗЫВАЕТ — дашборд состязания трёх прогнозистов.
 *
 * Владелец: «дашборд нужен с удачными исходами матчей внутри pro версии
 * Шерлок Скоулс и сравнением двух моделей „прогнозистов“: а) ллм б) мозг
 * дрозофилы в) свой вариант, улучшенный».
 *
 * ⚠️ ЭКРАН ПОКАЗЫВАЕТ ЗАМЕР, А НЕ РЕКЛАМУ. Честный итог такой: НИ ОДИН из
 * трёх не бьёт «всегда говори больше 2.5» по средней ошибке. Это написано на
 * экране прямым текстом, а не спрятано — потому что дашборд, который
 * показывает только хорошее, перестаёт быть измерением.
 *
 * ⚠️ ДОЛЯ УГАДАННЫХ И ПОКРЫТИЕ ВСЕГДА СТОЯТ РЯДОМ. «Свой вариант» молчит там,
 * где не уверен: 66 % у него — это 66 % на четырёх матчах из десяти. Показать
 * первое число без второго значит сравнить того, кто отвечает на лёгкие
 * вопросы, с теми, кто отвечает на все.
 */

/** Порядок и цвет — по модели, а не по месту в списке. */
const TINT: Record<DuelModel, string> = {
  own: 'text-brand-accent',
  llm: 'text-sky-300',
  fly: 'text-amber-300',
  median: 'text-brand-muted',
  current: 'text-brand-muted',
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Полоска доли угаданных.
 *
 * ⚠️ ШКАЛА НАЧИНАЕТСЯ НЕ С НУЛЯ, А С 50 %, и это не обман зрения, а наоборот.
 * Угадать сторону порога подбрасыванием монеты — это 50 %; полоска от нуля
 * показывала бы всем участникам почти одинаковые длинные столбцы и прятала
 * бы единственное, что здесь важно, — разницу между ними.
 */
function HitBar({ value, tint }: { value: number; tint: string }) {
  const span = Math.max(0, Math.min(1, (value - 0.5) / 0.3));
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div
        className={`h-full rounded-full ${tint.replace('text-', 'bg-')}`}
        style={{ width: `${Math.max(span * 100, 2)}%` }}
      />
    </div>
  );
}

function ModelCard({ row }: { row: DuelRow }) {
  const { t } = useTranslation();
  const tint = TINT[row.model] ?? 'text-brand-muted';
  const silent = row.coverage < 0.999;
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-black ds-display ${tint}`}>{t(`duel.model.${row.model}`)}</div>
          <div className="text-[11px] text-brand-muted leading-snug mt-0.5">
            {t(`duel.what.${row.model}`)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-black tabular-nums ${tint}`}>{pct(row.hit_rate)}</div>
          <div className="text-[10px] uppercase tracking-wider text-brand-muted">
            {t('duel.hit')}
          </div>
        </div>
      </div>

      <HitBar value={row.hit_rate} tint={tint} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-muted tabular-nums">
        <span>{t('duel.mae', { v: row.mae.toFixed(3) })}</span>
        {/* Покрытие печатается ТОЛЬКО у того, кто молчит: у остальных оно
            ровно единица, и строка «назвал 100 %» была бы шумом. */}
        {silent && (
          <span className="text-brand-accent">
            {t('duel.coverage', { v: pct(row.coverage) })}
          </span>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m }: { m: DuelMatch }) {
  const { t } = useTranslation();
  const mark = (hit: boolean | null) =>
    hit === null
      ? <span className="text-brand-muted/60" title={t('duel.silent')}>—</span>
      : <span className={hit ? 'text-emerald-400' : 'text-rose-400'}>{hit ? '✓' : '✗'}</span>;

  return (
    <tr className="border-t border-white/5">
      <td className="py-2 pr-2">
        <div className="text-white text-[13px] leading-tight truncate max-w-[9rem]">
          {m.home_name ?? '—'}
        </div>
        <div className="text-brand-muted text-[13px] leading-tight truncate max-w-[9rem]">
          {m.away_name ?? '—'}
        </div>
      </td>
      <td className="py-2 px-1 text-center font-black text-white tabular-nums">{m.total}</td>
      <td className="py-2 px-1 text-center tabular-nums">{mark(m.hit_own)}</td>
      <td className="py-2 px-1 text-center tabular-nums">{mark(m.hit_llm)}</td>
      <td className="py-2 pl-1 text-center tabular-nums">{mark(m.hit_fly)}</td>
    </tr>
  );
}

export function DuelScreen() {
  const { t, i18n } = useTranslation();
  const [models, setModels] = useState<LoadState<DuelRow[]>>(LOADING);
  const [matches, setMatches] = useState<LoadState<DuelMatch[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    // Оба запроса РЯДОМ, а не по очереди: таблица матчей не зависит от
    // сводки, и ждать её значило бы ждать по самому медленному.
    void fetchDuelModels().then((s) => { if (!cancelled) setModels(s); });
    void fetchDuelMatches(i18n.language).then((s) => { if (!cancelled) setMatches(s); });
    return () => { cancelled = true; };
  }, [i18n.language]);

  const rows = dataOr(models, []);
  const list = dataOr(matches, []);
  const any = rows[0];

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <ScreenHeader title={t('duel.title')} />

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        <p className="text-[12px] text-brand-muted leading-relaxed">{t('duel.intro')}</p>

        {/* ⚠️ ДОСКА ПРОГНОЗИСТОВ УЕХАЛА В АДМИНКУ (/admin, вкладка
            «Прогнозисты»), и возвращать её сюда не надо. Три модели, называющие
            победителя, читаются игроком как совет на что ставить, а точность у
            них 46–48 % при 44 % у «всегда хозяева». Этот экран остаётся про
            голы — там прогноз отвечает на вопрос, который сам же и задаёт. */}

        <div className="pt-2 text-[11px] uppercase tracking-wider text-brand-muted">
          {t('duel.goals_section')}
        </div>

        {models.status === 'error' && (
          <p className="text-[12px] text-rose-400">{t('duel.failed')}</p>
        )}

        {any && (
          <p className="text-[11px] text-brand-muted">
            {t('duel.basis', { n: any.matches })}
          </p>
        )}

        <div className="space-y-3">
          {rows.filter((r) => r.model !== 'median' && r.model !== 'current')
               .map((r) => <ModelCard key={r.model} row={r} />)}
        </div>

        {/* ⚠️ ТОЧКИ ОТСЧЁТА ОТДЕЛЬНО И НИЖЕ. Они не участники: это линейка,
            которой меряют участников. Смешать их в общий список значило бы
            предложить игроку «выбрать медиану» как прогнозиста. */}
        {rows.some((r) => r.model === 'median') && (
          <div className="rounded-2xl border border-white/10 p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-brand-muted">
              {t('duel.baseline_title')}
            </div>
            {rows.filter((r) => r.model === 'median' || r.model === 'current').map((r) => (
              <div key={r.model} className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white text-[13px]">{t(`duel.model.${r.model}`)}</div>
                  <div className="text-[11px] text-brand-muted">{t(`duel.what.${r.model}`)}</div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <span className="text-white font-bold">{pct(r.hit_rate)}</span>
                  <span className="text-[11px] text-brand-muted ml-2">{r.mae.toFixed(3)}</span>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-brand-muted leading-relaxed pt-1">
              {t('duel.verdict')}
            </p>
          </div>
        )}

        {list.length > 0 && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="text-[11px] uppercase tracking-wider text-brand-muted px-1 pb-1">
              {t('duel.recent')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-brand-muted">
                  <tr>
                    <th className="text-left font-normal pb-1">{t('duel.col_match')}</th>
                    <th className="px-1 font-normal pb-1">{t('duel.col_total')}</th>
                    <th className="px-1 font-normal pb-1 text-brand-accent">{t('duel.short.own')}</th>
                    <th className="px-1 font-normal pb-1 text-sky-300">{t('duel.short.llm')}</th>
                    <th className="pl-1 font-normal pb-1 text-amber-300">{t('duel.short.fly')}</th>
                  </tr>
                </thead>
                <tbody>{list.map((m, i) => <MatchRow key={`${m.match_date}-${i}`} m={m} />)}</tbody>
              </table>
            </div>
            <p className="text-[11px] text-brand-muted pt-2 px-1">{t('duel.legend')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
