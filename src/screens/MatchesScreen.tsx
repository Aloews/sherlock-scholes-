import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBallFootball } from '@tabler/icons-react';
import {
  fetchUpcomingFixtures,
  fetchFixturesInMonth,
  fetchFixturesHorizon,
  groupByDay,
  type Fixture,
} from '@/features/fixtures/fixturesApi';
import { LOADING, ok, dataOr, type LoadState } from '@/shared/lib/loadState';
import { leagueKey, readableSportKey } from '@/features/fixtures/leagues';
import { fetchMyPredictions, type Prediction } from '@/features/fixtures/predictionsApi';
import { PredictorsPanel } from '@/features/fixtures/PredictorsPanel';
import { FixtureCard } from '@/features/fixtures/FixtureCard';
import { MonthCalendar } from '@/features/fixtures/MonthCalendar';
import { monthStart, localDayKey, type Horizon } from '@/features/fixtures/monthCalendar';
import { fetchBroadcasts, type Broadcast } from '@/features/fixtures/broadcastsApi';
import { fetchBroadcastRights, type BroadcastRight } from '@/features/fixtures/broadcastRightsApi';
import { systemLanguages, viewerCountry } from '@/features/fixtures/viewerCountry';
import { getRawInitData, hapticImpact } from '@/shared/lib/telegram';
import { Chip } from '@/shared/ui/Chip';
import { timeFormat, weekdayDateFormat } from '@/shared/lib/dateFormat';

/**
 * What football is on next.
 *
 * NO ODDS, AND NOTHING DERIVED FROM THEM. Not "favourite", not a highlighted
 * side, not an ordering that encodes one. `fixture_odds` has no grant and no
 * policy, so this screen could not read them if it tried, and the schema is
 * where that decision lives rather than a comment somebody has to obey.
 *
 * KICK-OFF TIMES ARE THE VIEWER'S. The provider stores UTC; a 22:00 UTC match
 * is tonight in Madrid and tomorrow morning in Tokyo, and grouping by day has
 * to happen where the viewer is standing.
 *
 * ДВА РЕЖИМА, И ОНИ ОТВЕЧАЮТ НА РАЗНЫЕ ВОПРОСЫ. Список — «что дальше»:
 * ближайшие матчи подряд, начиная с сейчас. Календарь — «что в этом месяце»,
 * и он включает уже сыгранные дни со счётом, которых в списке нет и быть не
 * должно. Поэтому и запросы разные: список отсекает прошлое, календарь берёт
 * месяц целиком.
 */
export function MatchesScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'list' | 'calendar'>('list');

  const [upcoming, setUpcoming] = useState<LoadState<Fixture[]>>(LOADING);
  const [predictions, setPredictions] = useState<LoadState<Prediction[]>>(LOADING);
  const [broadcasts, setBroadcasts] = useState<Map<string, Broadcast>>(new Map());
  // Правообладатель для страны читателя. Пустая карта — нормальное состояние:
  // страна может быть не объявлена, а для объявленной вещателя может не быть
  // вовсе (у Премьер-лиги для России его нет). В обоих случаях карточка
  // покажет ссылку на страницу турнира, как показывала до сих пор.
  const [rights, setRights] = useState<Map<string, BroadcastRight>>(new Map());

  // Календарь: свой месяц, свои матчи и горизонт.
  const [month, setMonth] = useState<Date>(() => monthStart(new Date()));
  const [monthRows, setMonthRows] = useState<LoadState<Fixture[]>>(LOADING);
  const [horizon, setHorizon] = useState<Horizon>({ first: null, publishedUntil: null });
  const [day, setDay] = useState<string | null>(null);

  // null — «все турниры». Не пустое множество: пустое пришлось бы всюду
  // читать как «ничего не выбрано, значит показать всё», и одна забытая
  // проверка превратила бы фильтр в пустой экран.
  const [league, setLeague] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Расписание и свои прогнозы — ВМЕСТЕ, и это не лень: список без
      // прогнозов на мгновение нарисовал бы каждый матч как несыгранный и
      // тут же переписал себя. Одна вспышка неправды хуже мгновения пустоты.
      //
      // А трансляции — ОТДЕЛЬНО, потому что они добавляют строку под матчем и
      // ничего не переписывают. Держать из-за них весь экран значит ждать по
      // самому медленному запросу там, где можно ждать по самому быстрому.
      void fetchBroadcasts().then((tv) => { if (!cancelled) setBroadcasts(tv); });
      // Страна берётся из ОБЪЯВЛЕННОГО региона локали, а не выводится из
      // языка: испанский — это и Испания, и Мексика, и Аргентина. Нет
      // региона — нет запроса, см. viewerCountry.ts.
      void fetchBroadcastRights(viewerCountry(i18n.language, systemLanguages()))
        .then((r) => { if (!cancelled) setRights(r); });

      const [rows, mine] = await Promise.all([
        fetchUpcomingFixtures(),
        fetchMyPredictions(getRawInitData()),
      ]);
      if (cancelled) return;
      setUpcoming(rows);
      setPredictions(mine);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Месяц грузится только когда календарь открыт.
   *
   * Горизонт — ВСЕЙ таблицы, а не месяца, поэтому он и не зависит от `month`:
   * сентябрь сам по себе не знает, что август расписан целиком. Ошибку
   * горизонта экран переживает: клетки просто станут «не знаем», и это
   * честнее, чем объявить их пустыми.
   */
  useEffect(() => {
    if (mode !== 'calendar') return;
    let cancelled = false;
    setMonthRows(LOADING);
    void (async () => {
      const [rows, edge] = await Promise.all([
        fetchFixturesInMonth(month),
        fetchFixturesHorizon(),
      ]);
      if (cancelled) return;
      setMonthRows(rows);
      if (edge.status === 'ok') setHorizon(edge.data);
    })();
    return () => { cancelled = true; };
  }, [mode, month]);

  const byFixture = useMemo(() => {
    const map = new Map<string, Prediction>();
    for (const p of dataOr(predictions, [])) map.set(p.fixture_id, p);
    return map;
  }, [predictions]);

  /** Что вообще показывает экран в текущем режиме — до фильтров. */
  const source = mode === 'list' ? upcoming : monthRows;

  /**
   * Турниры — ИЗ САМОГО СПИСКА, а не из KNOWN_SPORT_KEYS.
   *
   * Провайдер заводит новый ключ каждый раз, когда начинается турнир, и
   * фильтр по заранее написанному перечню молча потерял бы его. А чип для
   * лиги, которой сегодня нет в расписании, — это кнопка, ведущая в пустоту.
   *
   * Порядок — по числу матчей: лига, которой сегодня много, стоит первой.
   */
  const leagues = useMemo(() => {
    const count = new Map<string, number>();
    for (const f of dataOr(source, [])) count.set(f.sport_key, (count.get(f.sport_key) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [source]);

  const shown = useMemo(() => {
    let rows = dataOr(source, []);
    if (league !== null) rows = rows.filter((f) => f.sport_key === league);
    // Выбранный день сужает месяц. Ключ считается ровно так же, как в сетке —
    // одной и той же функцией, иначе граница дня в двух местах разойдётся.
    if (mode === 'calendar' && day !== null) {
      rows = rows.filter((f) => localDayKey(new Date(f.commence_at)) === day);
    }
    return rows;
  }, [source, league, mode, day]);

  const days = useMemo(() => groupByDay(shown), [shown]);

  // Built once per language rather than per row: a formatter is expensive and
  // a list of sixty matches would otherwise build sixty of them.
  const timeFmt = useMemo(() => timeFormat(i18n.language), [i18n.language]);
  const dayFmt = useMemo(() => weekdayDateFormat(i18n.language), [i18n.language]);

  const dayLabel = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const daysApart = Math.round((midnight(date) - midnight(today)) / 86_400_000);
    if (daysApart === 0) return t('matches.today');
    if (daysApart === 1) return t('matches.tomorrow');
    return dayFmt.format(date);
  };

  const savePrediction = (saved: Prediction) => {
    // Свой только что сохранённый прогноз — знание достоверное, даже если
    // загрузка остальных не удалась. Поэтому список становится ok: игрок
    // видит то, что сделал прямо сейчас.
    setPredictions((prev) => ok([
      saved,
      ...dataOr(prev, []).filter((p) => p.fixture_id !== saved.fixture_id),
    ]));
  };

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black">{t('matches.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        {/* Счётчик и рейтинг считает сервер: на этом экране лежат только
            ближайшие матчи, а очки заработаны и на давно сыгранных. Локальная
            сумма показывала бы меньше и молча. */}
        <PredictorsPanel />

        <p className="text-brand-muted text-[10.5px]">{t('matches.rules')}</p>

        {/* НЕ БАННЕР ПОВЕРХ СПИСКА: расписание загрузилось и им можно
            пользоваться. Проблема узкая — не видно СВОИХ прогнозов, и матчи
            выглядят непредсказанными. Без этой строки игрок вводит счёт
            заново, сервер отвечает «уже есть», и виноватым выглядит игрок. */}
        {predictions.status === 'error' && (
          <p className="text-red-400/80 text-[10.5px]">{t('matches.predictions_failed')}</p>
        )}

        {/* ─── Режим ───
            Выбор режима сбрасывает выбранный день: он существует только в
            календаре, и остаться в списке с невидимым фильтром «только 16-е»
            значит показать полупустой список без единого объяснения. */}
        <div className="flex gap-1.5">
          <Chip
            label={t('matches.mode_list')}
            selected={mode === 'list'}
            onClick={() => { hapticImpact('light'); setMode('list'); setDay(null); }}
          />
          <Chip
            label={t('matches.mode_calendar')}
            selected={mode === 'calendar'}
            onClick={() => { hapticImpact('light'); setMode('calendar'); setDay(null); }}
          />
        </div>

        {mode === 'calendar' && (
          <MonthCalendar
            month={month}
            onMonthChange={(next) => { setMonth(next); setDay(null); }}
            fixtures={dataOr(monthRows, [])}
            horizon={horizon}
            selected={day}
            onSelect={setDay}
          />
        )}

        {/* ─── Турниры ───
            Горизонтальная лента, а не сетка: турниров бывает двадцать, и
            сеткой они съедают экран до первого матча. Считанное число матчей
            стоит прямо на чипе — иначе выбор вслепую, и половина чипов ведёт
            в список из одного матча. */}
        {leagues.length > 1 && (
          <div className="-mx-4 px-4 overflow-x-auto">
            <div className="flex gap-1.5 w-max pb-0.5">
              <Chip
                label={t('matches.all_leagues')}
                selected={league === null}
                onClick={() => { hapticImpact('light'); setLeague(null); }}
              />
              {leagues.map(([key, n]) => (
                <Chip
                  key={key}
                  label={`${t(leagueKey(key), { defaultValue: readableSportKey(key) })} · ${n}`}
                  selected={league === key}
                  onClick={() => { hapticImpact('light'); setLeague(league === key ? null : key); }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Три состояния, и они правда разные: ещё спрашиваем; спросили и
            ничего нет; спросили и вот оно. Схлопнуть первые два значит
            показать «матчей нет» тому, у кого список в одном запросе. */}
        {source.status === 'loading' && (
          <p className="text-brand-muted text-sm text-center py-8">{t('matches.loading')}</p>
        )}

        {/* «Расписание пустое» успокаивает и тогда, когда всё сломалось, — а
            здесь оно правдоподобно как нигде: межсезонье и пауза на сборные
            выглядят точно так же. Поэтому отказ говорит о себе отдельно. */}
        {source.status === 'error' && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('matches.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">{source.code}</p>
          </div>
        )}

        {/* Пустой месяц и пустое расписание — разные утверждения, поэтому и
            надписи разные. Месяц за горизонтом публикации не «пуст»: про него
            просто ещё ничего не известно, и сказать иначе значит объявить,
            что футбола не будет. */}
        {source.status === 'ok' && source.data.length === 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center">
            <IconBallFootball size={28} stroke={1.5} className="mx-auto text-brand-muted mb-2" />
            <p className="text-brand-muted text-sm">
              {mode === 'calendar' ? t('matches.month_unknown') : t('matches.empty')}
            </p>
          </div>
        )}

        {source.status === 'ok' && source.data.length > 0 && shown.length === 0 && (
          <p className="text-brand-muted text-sm text-center py-8">
            {mode === 'calendar' && day !== null
              ? t('matches.empty_day')
              : t('matches.empty_league')}
          </p>
        )}

        {days.map(({ day: key, fixtures: list }) => (
          <div key={key} className="space-y-2">
            <p className="text-brand-muted text-xs uppercase tracking-wider">{dayLabel(key)}</p>
            {list.map((fixture) => (
              <FixtureCard
                key={fixture.id}
                fixture={fixture}
                broadcast={broadcasts.get(fixture.sport_key)}
                rights={rights.get(fixture.sport_key)}
                prediction={byFixture.get(fixture.id)}
                onPredictionSaved={savePrediction}
                timeFmt={timeFmt}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
