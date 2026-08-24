import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBallFootball } from '@tabler/icons-react';
import {
  fetchRatings,
  fetchFreshness,
  type RatingRow,
  type RatingFreshness,
} from '@/features/ratings/ratingsApi';
import {
  ageInDays,
  windowExceedsData,
  RATING_WINDOWS,
  type RatingWindow,
} from '@/features/ratings/freshness';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { Chip } from '@/shared/ui/Chip';
import { longDateFormat } from '@/shared/lib/dateFormat';

/**
 * Рейтинг футболистов за неделю, месяц и год.
 *
 * ЭКРАН ПОСТРОЕН ПОСЛЕДНИМ, И ЭТО НЕ ОЧЕРЁДНОСТЬ, А УСЛОВИЕ. Данных о голах и
 * пасах в базе не было вообще: `player_stats` — про игроков приложения,
 * `player_seasons` — про просмотры, `player_career` пуст. Сначала появился
 * конвейер (football_scraper/sports_ru_stats.py → player_match_stats),
 * и только потом это.
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН PROMISE.ALL. Рейтинг и свежесть независимы, и экран,
 * ждущий по самому медленному, уже стоил этому проекту отдельного разбора
 * (DigestScreen, docs/MAP.md §9). Список приходит когда придёт, подпись — когда
 * придёт она.
 *
 * ПУСТОТА ЗДЕСЬ УТВЕРЖДАЕТ. «За неделю никто не забил» — правда во время
 * паузы на сборные и ложь при мёртвом конвейере, а выглядит одинаково. Поэтому
 * пустой список подписан датой последнего сбора, а не оставлен молчать.
 */
export function RatingsScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<RatingWindow>(7);
  const [rows, setRows] = useState<LoadState<RatingRow[]>>(LOADING);
  const [fresh, setFresh] = useState<LoadState<RatingFreshness | null>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchRatings(days).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [days]);

  useEffect(() => {
    let cancelled = false;
    void fetchFreshness().then((r) => { if (!cancelled) setFresh(r); });
    return () => { cancelled = true; };
  }, []);

  const dateFmt = longDateFormat(i18n.language);

  const freshness = fresh.status === 'ok' ? fresh.data : null;
  const collectedAge = ageInDays(freshness?.collected_at ?? null);
  const partial = windowExceedsData(days, freshness?.first_match ?? null);

  return (
    <div className="min-h-screen bg-brand-bg pb-24">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={1.5} />
          </button>
          <h1 className="ds-display text-white text-lg font-bold">{t('ratings.title')}</h1>
        </div>

        {/* Окна — то, что просили: неделя, месяц, год. */}
        <div className="-mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-0.5">
            {RATING_WINDOWS.map((w) => (
              <Chip
                key={w}
                label={t(`ratings.window_${w}`)}
                selected={days === w}
                onClick={() => { hapticImpact('light'); setDays(w); }}
              />
            ))}
          </div>
        </div>

        {/* Из чего складывается число. Рейтинг, который нельзя пересчитать
            глазами, читается как выдуманный — а он и правда выдуман, если его
            никто не может проверить. */}
        <p className="text-brand-muted/70 text-[11px]">{t('ratings.formula')}</p>

        {/* Окно шире, чем собранные данные. Молчать здесь нельзя: «за год»
            пообещает год, которого в таблице пока нет. */}
        {partial && freshness?.first_match && (
          <p className="text-brand-muted text-[11px]">
            {t('ratings.partial', { date: dateFmt.format(new Date(freshness.first_match)) })}
          </p>
        )}

        {rows.status === 'loading' && (
          <p className="text-brand-muted text-sm text-center py-8">{t('ratings.loading')}</p>
        )}

        {rows.status === 'error' && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('ratings.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">{rows.code}</p>
          </div>
        )}

        {rows.status === 'ok' && rows.data.length === 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
            <IconBallFootball size={28} stroke={1.5} className="mx-auto text-brand-muted" />
            <p className="text-brand-muted text-sm">{t('ratings.empty')}</p>
            {/* Без этой строки пустота говорила бы про футбол, хотя может
                говорить про сбор. */}
            {collectedAge !== null && (
              <p className="text-brand-muted/60 text-[11px]">
                {t('ratings.collected', { count: collectedAge })}
              </p>
            )}
          </div>
        )}

        {rows.status === 'ok' && rows.data.map((row, i) => (
          <div
            key={row.card_id}
            className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3"
          >
            <span className="ds-display text-brand-muted text-sm font-bold tabular-nums w-6 text-right shrink-0">
              {i + 1}
            </span>

            {row.photo_url ? (
              // player_ratings() only ever joins player_match_stats, so every
              // row here is a footballer — PlayerPhoto's 'player' default fits.
              <PlayerPhoto
                src={row.photo_url}
                className="w-9 h-9 rounded-full shrink-0 bg-brand-bg"
              />
            ) : (
              <span className="w-9 h-9 rounded-full bg-brand-bg shrink-0" />
            )}

            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate">{row.name}</p>
              <p className="text-brand-muted text-[11px] truncate">
                {/* Клуб выводится из открытых лет в карьере и бывает
                    устаревшим, поэтому рядом всегда стоит число матчей окна —
                    оно из этого же окна и не может разойтись с ним. */}
                {[row.club, t('ratings.matches', { count: row.matches })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className="ds-display text-white text-sm font-bold tabular-nums">{row.points}</p>
              <p className="text-brand-muted text-[10.5px] tabular-nums">
                {t('ratings.goals_assists', { goals: row.goals, assists: row.assists })}
              </p>
            </div>
          </div>
        ))}

        {/* Подпись под списком, а не над ним: пока список читают, она не
            мешает, а вопрос «свежее ли это» возникает уже после. */}
        {rows.status === 'ok' && rows.data.length > 0 && collectedAge !== null && (
          <p className="text-brand-muted/60 text-[11px] text-center pt-1">
            {t('ratings.collected', { count: collectedAge })}
          </p>
        )}
      </div>
    </div>
  );
}
