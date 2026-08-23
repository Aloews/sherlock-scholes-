import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconHistory, IconChevronDown } from '@tabler/icons-react';
import { getRawInitData, hapticImpact } from '@/shared/lib/telegram';
import { leagueKey, readableSportKey } from './leagues';
import { fetchPredictionHistory, type PredictionHistoryEntry } from './predictionsApi';

/**
 * Прошлые прогнозы — команды, свой счёт, реальный счёт, очки.
 *
 * ЗАКРЫТА ПО УМОЛЧАНИЮ, и это не украшение. `PredictorsPanel` уже занимает
 * верх экрана расписания, а список матчей — низ; между ними список из
 * пятидесяти строк вытеснил бы то, ради чего экран открывают чаще всего —
 * ближайшие матчи. История нужна не каждый раз, а по запросу.
 *
 * ПУСТОЙ СПИСОК СКРЫВАЕТ КНОПКУ ЦЕЛИКОМ — так же, как `PredictorsPanel`
 * прячет себя при нуле прогнозов. Кнопка «история», ведущая в пустоту, хуже,
 * чем кнопки нет вовсе.
 */
export function PredictionHistory() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PredictionHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!open || rows !== null) return;
    void fetchPredictionHistory(getRawInitData()).then(setRows);
  }, [open, rows]);

  // Загрузку не показываем молча вечно — но и до открытия ничего не грузим:
  // список нужен не всем, кто открыл экран, платить сетевым запросом за
  // каждого — не за того, кто нажал.
  if (open && rows !== null && rows.length === 0) return null;

  const dayFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => { hapticImpact('light'); setOpen((v) => !v); }}
        className="w-full p-3 flex items-center gap-2 text-left"
      >
        <IconHistory size={14} stroke={1.75} className="text-brand-muted shrink-0" />
        <span className="flex-1 text-brand-muted text-[10.5px] uppercase tracking-wider">
          {t('matches.prediction_history')}
        </span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={`text-brand-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {rows === null ? (
            <p className="text-brand-muted text-sm py-2">{t('matches.history_loading')}</p>
          ) : (
            rows.map((row) => {
              // Ожидает счёта — не то же самое, что 0:0. Различаются надписью,
              // а не приблизительным числом.
              const pending = row.actual_home === null;
              const exact = !pending
                && row.pred_home === row.actual_home && row.pred_away === row.actual_away;
              return (
                <div key={row.fixture_id} className="flex items-center gap-2 py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate">
                      {row.home_team} — {row.away_team}
                    </p>
                    <p className="text-brand-muted text-[10.5px] mt-0.5">
                      {dayFmt.format(new Date(row.commence_at))}
                      {' · '}
                      {t(leagueKey(row.sport_key), { defaultValue: readableSportKey(row.sport_key) })}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="ds-display text-white text-sm font-bold tabular-nums">
                      {row.pred_home}:{row.pred_away}
                    </p>
                    <p className="text-brand-muted text-[10.5px] tabular-nums mt-0.5">
                      {pending
                        ? t('matches.history_pending')
                        : `${row.actual_home}:${row.actual_away}`}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 w-9 text-right ds-display text-sm font-bold tabular-nums ${
                      pending ? 'text-brand-muted' : exact ? 'text-brand-accent' : 'text-white'
                    }`}
                  >
                    {pending ? '—' : `+${row.points ?? 0}`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
