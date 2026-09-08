import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatEur } from '@/shared/lib/money';
import { fixtureCountdown } from '@/shared/lib/fixtureCountdown';
import { hapticImpact } from '@/shared/lib/telegram';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { fetchTopFixtures, type TopFixture } from '@/features/ratings/ratingsApi';
import { Crest } from './Crest';

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
 * ⚠️ МЕСТО ПОД БЛОК РЕЗЕРВИРУЕТСЯ, ПОКА ИДЁТ ЗАПРОС. Раньше не резервировалось,
 * и это было верно: блок стоял НИЖЕ кнопок игры и, появляясь, сдвигал только
 * то, что под ним. Владелец попросил поднять матчи выше новостей — теперь над
 * ним нет ничего, а под ним и превью гола, и все кнопки игры. Пришедший
 * позже блок увёл бы «Алиас» из-под уже летящего пальца.
 *
 * Место держит СКЕЛЕТ ИЗ ТЕХ ЖЕ КЛАССОВ, а не подобранная в пикселях высота:
 * высота выходит одинаковой по построению, и её не надо править всякий раз,
 * когда в строке матча меняется отступ.
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

  // Пока ответа нет — скелет ровно той же высоты (см. ⚠️ выше).
  if (rows.status === 'loading') return <FixturesSkeleton limit={limit} />;

  // Матчей нет — блока нет. Пустая рамка с подписью «матчей нет» на главной
  // сообщает о нашем конвейере, а не о футболе. Схлопывание после ответа
  // экран всё-таки сдвинет, но вверх и только когда матчей действительно нет;
  // держать пустоту вечно ради этого случая — хуже.
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
        // ⚠️ ОБРАТНЫЙ ОТСЧЁТ ВМЕСТО ДАТЫ, ПОКА ОН ЧТО-ТО ЗНАЧИТ. Владелец:
        // «сделай так чтобы за полчаса анонсировали трансляцию матча». Дата
        // «7 сент., 21:00» не говорит, успеваешь ты или нет; «через 25 минут»
        // говорит. Дальше суток обратный отсчёт снова хуже даты — правило
        // целиком в `fixtureCountdown`, второй его копии здесь нет.
        const cd = fixtureCountdown(f.minutes_to_start);
        const alert = cd.kind === 'alert' || cd.kind === 'live';
        const timing =
          cd.kind === 'live'  ? t('fixtures.live')
          : cd.kind === 'alert' ? t('fixtures.in_minutes', { count: cd.minutes })
          : cd.kind === 'hours' ? t('fixtures.in_hours', { count: cd.hours })
          : date;
        return (
          <button
            key={f.fixture_id}
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/matches'); }}
            className={`w-full text-left ds-panel bg-brand-surface border rounded-2xl p-3
                        active:opacity-70 transition-opacity ${
              // Матч, на который ещё можно успеть, отличается рамкой: это
              // единственная строка здесь, требующая действия сейчас.
              alert ? 'border-brand-accent' : 'border-brand-border'
            }`}
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
              <span className={`text-[10.5px] truncate flex-1 min-w-0 ${
                alert ? 'text-brand-accent font-semibold' : 'text-brand-muted'
              }`}>
                {[comp, timing].filter(Boolean).join(' · ')}
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

/**
 * Скелет на время запроса.
 *
 * ⚠️ КЛАССЫ ЗДЕСЬ ОБЯЗАНЫ СОВПАДАТЬ СО СТРОКОЙ МАТЧА — в этом весь смысл.
 * Высота считается браузером из тех же отступов и тех же кеглей, поэтому
 * подмена скелета настоящими матчами не двигает ни пикселя. Число в px здесь
 * молча разъехалось бы с версткой при первой же правке `p-3`.
 */
function FixturesSkeleton({ limit }: { limit: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2" aria-hidden>
      <p className="text-brand-muted text-[11px] uppercase tracking-wide px-0.5">
        {t('fixtures.top_title')}
      </p>
      {Array.from({ length: limit }, (_, i) => (
        <div
          key={i}
          className="w-full ds-panel bg-brand-surface border border-brand-border
                     rounded-2xl p-3 animate-pulse"
        >
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 shrink-0 rounded-full bg-brand-border" />
            <span className="text-[12.5px] flex-1 min-w-0">
              <span className="block h-[1em] rounded bg-brand-border" />
            </span>
            <span className="text-brand-muted text-[11px] shrink-0">—</span>
            <span className="text-[12.5px] flex-1 min-w-0">
              <span className="block h-[1em] rounded bg-brand-border" />
            </span>
            <span className="w-6 h-6 shrink-0 rounded-full bg-brand-border" />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10.5px] flex-1 min-w-0">
              <span className="block h-[1em] rounded bg-brand-border" />
            </span>
            <span className="text-[10.5px] w-12 shrink-0">
              <span className="block h-[1em] rounded bg-brand-border" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
