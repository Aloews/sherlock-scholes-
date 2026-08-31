import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrophy } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { Chip } from '@/shared/ui/Chip';
import { getRawInitData, hapticImpact } from '@/shared/lib/telegram';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import {
  fetchLeaderboard, fetchFriendLeaderboard, fetchMyStats,
  type MyPredictionStats, type PredictorRow,
} from './predictionsApi';

type Scope = 'all' | 'friends';

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
  const initData = getRawInitData();
  const [top, setTop] = useState<LoadState<PredictorRow[]>>(LOADING);
  const [friends, setFriends] = useState<LoadState<PredictorRow[]>>(LOADING);
  const [mine, setMine] = useState<MyPredictionStats | null>(null);
  // Друзья видны только в Telegram: без initData нельзя узнать, кто они, и
  // переключатель на пустую вкладку, которая никогда ничего не покажет, хуже
  // отсутствующего переключателя.
  const [scope, setScope] = useState<Scope>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [board, friendBoard, stats] = await Promise.all([
        fetchLeaderboard(TOP_N),
        fetchFriendLeaderboard(initData, TOP_N),
        fetchMyStats(initData),
      ]);
      if (cancelled) return;
      setTop(board);
      setFriends(friendBoard);
      setMine(stats);
    })();
    return () => { cancelled = true; };
  }, [initData]);

  // Ещё грузится — ничего, чтобы не мигнуть «пока никого» тому, у кого список
  // в одном запросе отсюда. Раньше это состояние изображал `null`, и оно же
  // означало отказ; теперь их два, и отличить их можно, не читая код.
  if (top.status === 'loading') return null;

  const topRows = dataOr(top, []);
  const friendRows = dataOr(friends, []);
  const rows = scope === 'friends' ? friendRows : topRows;
  // ОТКАЗ ЗДЕСЬ НЕ ПОКАЗЫВАЕТСЯ ОТДЕЛЬНОЙ НАДПИСЬЮ, и это выбор, а не забывчивость.
  // Панель необязательная: свой счёт человек видит выше, а таблица лучших —
  // приятное дополнение. Красная строка на экране расписания из-за неё
  // отвлекала бы от того, ради чего экран открыт. Отказ виден в консоли с
  // кодом (fromPostgrest) — этого хватает, чтобы его расследовать. Та же
  // тишина и у вкладки «Друзья»: пустой её список означает не «друзей нет» —
  // вызывающий входит в friend_prediction_leaderboard() всегда, своей же
  // строкой, — а неудавшийся запрос, то есть тот же класс отказа, что и у
  // всей панели, и лечится тем же — молчанием здесь и логом в консоли.
  //
  // Гейт панели целиком — по ГЛОБАЛЬНОЙ таблице и своей сводке, не по друзьям:
  // у нового игрока друзей может не быть никогда, и это не повод прятать
  // весь блок, а переключатель на пустую вкладку по крайней мере покажет
  // самого игрока — friend_prediction_leaderboard() включает вызывающего.
  const nothingAtAll = topRows.length === 0 && (mine === null || mine.settled + mine.pending === 0);
  if (nothingAtAll) return null;
  const showFriendsTab = !!initData;

  return (
    <div className="space-y-3">
      {mine && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-start gap-3">
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

          {/* Точность — то, чем теперь считается место. Стоит РЯДОМ с очками,
              а не вместо них: очки остаются наградой за объём, место больше от
              него не зависит, и видеть надо оба числа сразу, иначе разъехавшиеся
              «много очков» и «низкое место» читаются как поломка.

              ⚠️ ПРОЧЕРК ДО ПЯТИ ЗАКРЫТЫХ ПРОГНОЗОВ, и это `outcome_rate`, а не
              `accuracy`: 50% по двум прогнозам — шум, а не оценка, и круглое
              число на его месте врёт увереннее, чем прочерк. Число закрытых
              стоит строкой ниже, так что прочерк объяснён. */}
          <div className="text-right shrink-0">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('matches.my_accuracy')}
            </p>
            <p className="ds-display text-white text-2xl font-black leading-none mt-1 tabular-nums">
              {mine.outcome_rate === null ? '—' : `${mine.outcome_rate}%`}
            </p>
            <p className="text-brand-muted text-[10.5px] mt-1 tabular-nums">
              {t('matches.my_outcomes', { hits: mine.outcome_hits, settled: mine.settled })}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('matches.my_rank')}
            </p>
            <p className="ds-display text-white text-2xl font-black leading-none mt-1">
              {mine.rank === null ? '—' : `#${mine.rank}`}
            </p>
            <p className="text-brand-muted text-[10.5px] mt-1 tabular-nums">
              {t('matches.my_rating', { n: mine.rating })}
            </p>
          </div>
        </div>
      )}

      {(showFriendsTab || topRows.length > 0) && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider flex items-center gap-1">
              <IconTrophy size={13} stroke={2} />
              {t('matches.top_predictors')}
            </p>
            {showFriendsTab && (
              <div className="flex gap-1.5 shrink-0">
                <Chip
                  label={t('matches.scope_all')}
                  selected={scope === 'all'}
                  onClick={() => { hapticImpact('light'); setScope('all'); }}
                />
                <Chip
                  label={t('matches.scope_friends')}
                  selected={scope === 'friends'}
                  onClick={() => { hapticImpact('light'); setScope('friends'); }}
                />
              </div>
            )}
          </div>

          {/* Новое число надо назвать. Рейтинг без объяснения — это просто
              цифра, из-за которой человек с 81 очком стоит ниже человека с
              пятью, и молчание тут читается как баг. */}
          <p className="text-brand-muted text-[10px] leading-snug">
            {t('matches.rating_explained')}
          </p>

          {rows.map((row, index) => {
            const name = `${row.first_name} ${row.last_name ?? ''}`.trim();
            return (
              <div key={row.player_id} className="flex items-center gap-2">
                <span className="ds-display text-brand-muted text-xs w-5 text-right tabular-nums">
                  {index + 1}
                </span>
                <Avatar name={name} src={row.avatar_url ?? undefined} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-white text-sm leading-tight">{name}</p>
                  {/* Из чего сложился рейтинг — процент исходов, точные счета и
                      очки. Все три под именем, потому что справа теперь стоит
                      рейтинг, и без разбора он ничем не подкреплён. */}
                  <p className="truncate text-brand-muted text-[10px] tabular-nums">
                    {t('matches.row_breakdown', {
                      accuracy: row.outcome_rate === null ? '—' : row.outcome_rate,
                      exact: row.exact,
                      points: row.points,
                    })}
                  </p>
                </div>
                {/* РЕЙТИНГ, А НЕ ОЧКИ: список отсортирован по нему, и очки
                    справа выглядели бы сбитой сортировкой. */}
                <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0 w-10 text-right">
                  {row.rating}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
