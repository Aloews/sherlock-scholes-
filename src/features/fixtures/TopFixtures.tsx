import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatEur } from '@/shared/lib/money';
import { hapticImpact } from '@/shared/lib/telegram';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { fetchTopFixtures, type TopFixture } from '@/features/ratings/ratingsApi';

/**
 * Самые важные ближайшие матчи — на главном экране.
 *
 * Владелец: «а самые важные предстоящие матчи выводить на главную с важными
 * данными и эмблемами».
 *
 * ⚠️ ВАЖНОСТЬ — СУММА СТОИМОСТИ ДВУХ СОСТАВОВ. Это выбор, и он назван прямо
 * на экране: под матчем стоит та самая сумма, по которой он сюда попал.
 * Рейтинг, который нельзя пересчитать глазами, читается как выдуманный.
 *
 * ⚠️ ТУРНИР БЕРЁТСЯ ИЗ МАТЧА, А НЕ ИЗ ЛИГИ ХОЗЯЕВ. Сперва подпись бралась из
 * `football_club.league`, и матч «Порту» — «Манчестер Сити» в Лиге чемпионов
 * подписывался «Португалия. Высшая лига». В еврокубках домашняя лига клуба и
 * турнир расходятся ВСЕГДА.
 *
 * ⚠️ МЕСТО ПОД БЛОК НЕ РЕЗЕРВИРУЕТСЯ, И ЭТО НАРОЧНО. В отличие от превью гола,
 * этот блок стоит НИЖЕ кнопок игры: появление после первого кадра не сдвигает
 * то, куда летит палец. Пустой скелет на главной ради ещё не пришедшего
 * ответа — плата без выигрыша.
 */
export function TopFixtures({ limit = 3 }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LoadState<TopFixture[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    void fetchTopFixtures(i18n.language, limit).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => { cancelled = true; };
  }, [i18n.language, limit]);

  // Матчей нет — блока нет. Пустая рамка с подписью «матчей нет» на главной
  // сообщает о нашем конвейере, а не о футболе.
  if (rows.status !== 'ok' || rows.data.length === 0) return null;

  const when = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="space-y-2">
      <p className="text-brand-muted text-[11px] uppercase tracking-wide px-0.5">
        {t('fixtures.top_title')}
      </p>

      {rows.data.map((f) => {
        // Турнир из матча; если ключа нет в переводах — домашняя лига клуба.
        // Молча показать пустоту нельзя: подпись объясняет, откуда матч.
        //
        // ⚠️ `.name` НА КОНЦЕ — НЕ УКРАШЕНИЕ. Ключ турнира приходит из
        // источника, и `soccer_france_ligue_one` кончается на `_one`, то есть
        // читается как форма множественного числа от `soccer_france_ligue`.
        // Проверка локалей на этом и упала. Ключ не наш, переименовать его
        // нельзя — значение лежит уровнем ниже.
        const key = f.sport_key ? `league.${f.sport_key}.name` : '';
        const comp = key && i18n.exists(key) ? t(key) : (f.league ?? '');
        let date = '';
        try {
          const d = new Date(f.commence_at);
          if (!Number.isNaN(d.getTime())) date = when.format(d);
        } catch {
          date = '';
        }
        return (
          <button
            key={f.fixture_id}
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/matches'); }}
            className="w-full text-left ds-panel bg-brand-surface border border-brand-border
                       rounded-2xl p-3 active:opacity-70 transition-opacity"
          >
            <div className="flex items-center gap-2">
              <Crest src={f.home_crest} alt={f.home_name ?? ''} />
              <span className="text-white text-[12.5px] flex-1 min-w-0 truncate">
                {f.home_name}
              </span>
              <span className="text-brand-muted text-[11px] shrink-0">—</span>
              <span className="text-white text-[12.5px] flex-1 min-w-0 truncate text-right">
                {f.away_name}
              </span>
              <Crest src={f.away_crest} alt={f.away_name ?? ''} />
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-brand-muted text-[10.5px] truncate flex-1 min-w-0">
                {[comp, date].filter(Boolean).join(' · ')}
              </span>
              {/* Число, по которому матч сюда попал — рядом с матчем. */}
              <span className="text-brand-accent text-[10.5px] tabular-nums shrink-0">
                {formatEur(f.importance, i18n.language)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Эмблема с местом под неё: без фиксированного размера строка прыгает,
 *  пока картинки грузятся по одной. */
function Crest({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <span className="w-6 h-6 shrink-0" />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-6 h-6 shrink-0 object-contain"
    />
  );
}
