import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrophy } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { getRawInitData } from '@/shared/lib/telegram';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import {
  fetchLeaderboard, fetchMyStats,
  type MyPredictionStats, type PredictorRow,
} from './predictionsApi';

/** Больше двадцати имён на телефоне никто не листает. */
const TOP_N = 20;

/**
 * Сколько очков у тебя, и кто угадывает лучше всех.
 *
 * ЛИЧНЫЙ СЧЁТЧИК СТОИТ ВЫШЕ ТАБЛИЦЫ и показывается даже с нулём: человек,
 * который только что поставил первый прогноз, должен видеть, что он посчитан,
 * а не пустое место. Незакрытые прогнозы названы отдельно — это не ноль очков,
 * это очки, которых ещё нет.
 *
 * МЕСТА НЕТ, ПОКА НЕТ ЗАКРЫТЫХ ПРОГНОЗОВ. `rank === null` — не последнее
 * место, и подставлять сюда «—» честнее, чем нарисовать номер, которого
 * человек не заслужил ни в одну сторону.
 */
export function PredictorsPanel() {
  const { t } = useTranslation();
  const [top, setTop] = useState<LoadState<PredictorRow[]>>(LOADING);
  const [mine, setMine] = useState<MyPredictionStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [board, stats] = await Promise.all([
        fetchLeaderboard(TOP_N),
        fetchMyStats(getRawInitData()),
      ]);
      if (cancelled) return;
      setTop(board);
      setMine(stats);
    })();
    return () => { cancelled = true; };
  }, []);

  // Ещё грузится — ничего, чтобы не мигнуть «пока никого» тому, у кого список
  // в одном запросе отсюда. Раньше это состояние изображал `null`, и оно же
  // означало отказ; теперь их два, и отличить их можно, не читая код.
  if (top.status === 'loading') return null;

  const rows = dataOr(top, []);
  // ОТКАЗ ЗДЕСЬ НЕ ПОКАЗЫВАЕТСЯ ОТДЕЛЬНОЙ НАДПИСЬЮ, и это выбор, а не забывчивость.
  // Панель необязательная: свой счёт человек видит выше, а таблица лучших —
  // приятное дополнение. Красная строка на экране расписания из-за неё
  // отвлекала бы от того, ради чего экран открыт. Отказ виден в консоли с
  // кодом (fromPostgrest) — этого хватает, чтобы его расследовать.
  const nothingYet = rows.length === 0 && (mine === null || mine.settled + mine.pending === 0);
  if (nothingYet) return null;

  return (
    <div className="space-y-3">
      {mine && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('matches.my_score')}
            </p>
            <p className="ds-display text-white text-2xl font-black leading-none mt-1">
              {mine.points}
            </p>
            <p className="text-brand-muted text-[10.5px] mt-1">
              {t('matches.my_breakdown', {
                settled: mine.settled,
                exact: mine.exact,
                pending: mine.pending,
              })}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('matches.my_rank')}
            </p>
            <p className="ds-display text-white text-2xl font-black leading-none mt-1">
              {mine.rank === null ? '—' : `#${mine.rank}`}
            </p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider flex items-center gap-1">
            <IconTrophy size={13} stroke={2} />
            {t('matches.top_predictors')}
          </p>

          {rows.map((row, index) => {
            const name = `${row.first_name} ${row.last_name ?? ''}`.trim();
            return (
              <div key={row.player_id} className="flex items-center gap-2">
                <span className="ds-display text-brand-muted text-xs w-5 text-right tabular-nums">
                  {index + 1}
                </span>
                <Avatar name={name} src={row.avatar_url ?? undefined} size="sm" />
                <p className="flex-1 min-w-0 truncate text-white text-sm">{name}</p>
                {/* Точные попадания рядом с очками: они отличают чутьё от
                    объёма, а очки одни этого не показывают. */}
                <span className="text-brand-muted text-[10.5px] shrink-0">
                  {t('matches.exact_short', { n: row.exact })}
                </span>
                <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0 w-8 text-right">
                  {row.points}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
