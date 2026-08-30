import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconBallFootball } from '@tabler/icons-react';
import {
  fetchRatings,
  fetchFreshness,
  type RatingRow,
  type RatingFreshness,
} from './ratingsApi';
import {
  ageInDays,
  windowExceedsData,
  RATING_WINDOWS,
  type RatingWindow,
} from './freshness';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { Chip } from '@/shared/ui/Chip';
import { longDateFormat } from '@/shared/lib/dateFormat';

interface RatingsListProps {
  /** Сколько строк показывать. Без ограничения — весь список. */
  limit?: number;
}

/**
 * Рейтинг футболистов — сам список, БЕЗ шапки экрана.
 *
 * ⚠️ ВЫНЕСЕН ИЗ RatingsScreen РАДИ ФЭНТЕЗИ, и вынесен, а не скопирован,
 * НАРОЧНО. Очки здесь считаются по той же шкале, что и в фэнтези
 * (`гол*4 + пас*3`), и две копии этой разметки означали бы, что однажды
 * они разойдутся — а разойтись им нельзя: игрок сравнивает число под
 * футболистом с числом в своём составе и вправе ждать, что это одно и то же.
 *
 * Загрузка здесь же, а не у родителя: список нужен обоим экранам вместе со
 * своими состояниями, и родитель, который тащил бы их сквозь себя, ничего бы
 * не выигрывал, кроме лишнего пробрасывания.
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
export function RatingsList({ limit }: RatingsListProps) {
  const { t, i18n } = useTranslation();
  // Строка рейтинга ведёт в досье того же футболиста. До этого она не вела
  // никуда: игрок видел имя и число и не мог узнать о человеке ничего, хотя
  // карточка с описанием, фотографией и историей матчей уже лежала рядом.
  const navigate = useNavigate();
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

  const all = rows.status === 'ok' ? rows.data : [];
  const shown = limit == null ? all : all.slice(0, limit);

  return (
    <div className="space-y-4">
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

      {rows.status === 'ok' && all.length === 0 && (
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

      {shown.map((row, i) => (
        <button
          key={row.card_id}
          type="button"
          onClick={() => { hapticImpact('light'); navigate(`/collection?card=${row.card_id}`); }}
          className="w-full text-left ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity"
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
              {/* Клуб собран из свидетельств и бывает устаревшим, поэтому
                  рядом всегда стоит число матчей окна — оно из этого же окна
                  и не может разойтись с ним. */}
              {[row.club, t('ratings.matches', { count: row.matches })]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {/* УРОВЕНЬ — ТО ЖЕ ЧИСЛО, ЧТО В КОЛЛЕКЦИИ. Раньше их было два: тир
              по известности в коллекции и очки по голам здесь, и игрок,
              стоящий первым в рейтинге, мог оставаться common. Показывается
              только когда он построен и на игре тоже: 'fame' значит «матчей
              мало», и такое число про футбол ничего не говорит. */}
          {row.level != null && row.basis === 'fame+form' && (
            <div className="text-right shrink-0 w-8">
              <p className="ds-display text-brand-accent text-sm font-bold tabular-nums">
                {row.level}
              </p>
              <p className="text-brand-muted/70 text-[9px] uppercase tracking-wide">
                {t('ratings.level')}
              </p>
            </div>
          )}

          <div className="text-right shrink-0">
            <p className="ds-display text-white text-sm font-bold tabular-nums">{row.points}</p>
            <p className="text-brand-muted text-[10.5px] tabular-nums">
              {t('ratings.goals_assists', { goals: row.goals, assists: row.assists })}
            </p>
          </div>
        </button>
      ))}

      {/* Подпись под списком, а не над ним: пока список читают, она не
          мешает, а вопрос «свежее ли это» возникает уже после. */}
      {rows.status === 'ok' && all.length > 0 && collectedAge !== null && (
        <p className="text-brand-muted/60 text-[11px] text-center pt-1">
          {t('ratings.collected', { count: collectedAge })}
        </p>
      )}
    </div>
  );
}
