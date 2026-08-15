import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBallFootball, IconDeviceTvOld } from '@tabler/icons-react';
import { fetchUpcomingFixtures, groupByDay, type Fixture } from '@/features/fixtures/fixturesApi';
import { leagueKey, readableSportKey } from '@/features/fixtures/leagues';
import { PredictionRow } from '@/features/fixtures/PredictionRow';
import { fetchMyPredictions, type Prediction } from '@/features/fixtures/predictionsApi';
import { PredictorsPanel } from '@/features/fixtures/PredictorsPanel';
import { fetchBroadcasts, type Broadcast } from '@/features/fixtures/broadcastsApi';
import { getRawInitData, hapticImpact, openLink } from '@/shared/lib/telegram';
import { Chip } from '@/shared/ui/Chip';

/**
 * What football is on next.
 *
 * The data has been in `fixtures` for a while with nothing reading it; this is
 * the screen it was collected for. Everything shown here comes from the free
 * `/events` endpoint — schedule only.
 *
 * NO ODDS, AND NOTHING DERIVED FROM THEM. Not "favourite", not a highlighted
 * side, not an ordering that encodes one. `fixture_odds` has no grant and no
 * policy, so this screen could not read them if it tried, and the schema is
 * where that decision lives rather than a comment somebody has to obey.
 *
 * KICK-OFF TIMES ARE THE VIEWER'S. The provider stores UTC; a 22:00 UTC match
 * is tonight in Madrid and tomorrow morning in Tokyo, and grouping by day has
 * to happen where the viewer is standing.
 */
export function MatchesScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  // null — «все турниры». Не пустое множество: пустое пришлось бы всюду
  // читать как «ничего не выбрано, значит показать всё», и одна забытая
  // проверка превратила бы фильтр в пустой экран.
  const [league, setLeague] = useState<string | null>(null);
  const [broadcasts, setBroadcasts] = useState<Map<string, Broadcast>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Together: a fixture list without the player's own predictions would
      // render every match as un-predicted for a moment, and then rewrite
      // itself. One flash of wrong is worse than one moment of nothing.
      // Расписание и свои прогнозы — ВМЕСТЕ, и это не лень: список без
      // прогнозов на мгновение нарисовал бы каждый матч как несыгранный и
      // тут же переписал себя. Одна вспышка неправды хуже мгновения пустоты.
      //
      // А трансляции — ОТДЕЛЬНО, потому что они добавляют строку под матчем и
      // ничего не переписывают. Держать из-за них весь экран значит ждать по
      // самому медленному запросу там, где можно ждать по самому быстрому.
      void fetchBroadcasts().then((tv) => { if (!cancelled) setBroadcasts(tv); });

      const [rows, mine] = await Promise.all([
        fetchUpcomingFixtures(),
        fetchMyPredictions(getRawInitData()),
      ]);
      if (cancelled) return;
      setFixtures(rows);
      setPredictions(mine);
    })();
    return () => { cancelled = true; };
  }, []);

  const byFixture = useMemo(() => {
    const map = new Map<string, Prediction>();
    for (const p of predictions) map.set(p.fixture_id, p);
    return map;
  }, [predictions]);

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
    for (const f of fixtures ?? []) count.set(f.sport_key, (count.get(f.sport_key) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [fixtures]);

  const shown = useMemo(
    () => (league === null ? fixtures ?? [] : (fixtures ?? []).filter((f) => f.sport_key === league)),
    [fixtures, league],
  );

  const days = useMemo(() => groupByDay(shown), [shown]);

  // Built once per language rather than per row: a formatter is expensive and
  // a list of sixty matches would otherwise build sixty of them.
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }),
    [i18n.language],
  );

  const dayLabel = (day: string): string => {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const daysApart = Math.round((midnight(date) - midnight(today)) / 86_400_000);
    if (daysApart === 0) return t('matches.today');
    if (daysApart === 1) return t('matches.tomorrow');
    return dayFmt.format(date);
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
        {/* Three states, and they are genuinely different: still asking,
            asked and there is nothing, asked and here it is. Collapsing the
            first two would show "no matches" to somebody whose list is one
            round trip away. */}
        {/* Счётчик и рейтинг считает сервер: на этом экране лежат только
            ближайшие матчи, а очки заработаны и на давно сыгранных. Локальная
            сумма показывала бы меньше и молча. */}
        <PredictorsPanel />

        <p className="text-brand-muted text-[10.5px]">{t('matches.rules')}</p>

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

        {fixtures === null && (
          <p className="text-brand-muted text-sm text-center py-8">{t('matches.loading')}</p>
        )}

        {fixtures !== null && fixtures.length === 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center">
            <IconBallFootball size={28} stroke={1.5} className="mx-auto text-brand-muted mb-2" />
            <p className="text-brand-muted text-sm">{t('matches.empty')}</p>
          </div>
        )}

        {fixtures !== null && fixtures.length > 0 && shown.length === 0 && (
          <p className="text-brand-muted text-sm text-center py-8">{t('matches.empty_league')}</p>
        )}

        {days.map(({ day, fixtures: list }) => (
          <div key={day} className="space-y-2">
            <p className="text-brand-muted text-xs uppercase tracking-wider">{dayLabel(day)}</p>

            {list.map((fixture) => (
              <div
                key={fixture.id}
                className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3"
              >
                <div className="flex items-center gap-3">
                <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0 w-12">
                  {timeFmt.format(new Date(fixture.commence_at))}
                </span>

                <div className="flex-1 min-w-0">
                  {/* The provider's spelling, in English. Translating club
                      names here would need a mapping we do not have for most
                      of these clubs, and a half-translated list reads worse
                      than a consistent one. */}
                  <p className="text-white text-sm truncate">{fixture.home_team}</p>
                  <p className="text-white text-sm truncate">{fixture.away_team}</p>
                </div>

                <span className="text-brand-muted text-[10.5px] text-right shrink-0 max-w-[35%]">
                  {t(leagueKey(fixture.sport_key), {
                    defaultValue: readableSportKey(fixture.sport_key),
                  })}
                </span>
                </div>

                {/* «Где смотреть» — страница САМОГО турнира, а не канал.
                    Права перепродаются каждый сезон, и строка «в вашей стране
                    это такой-то канал» устаревает молча: человек уходит не
                    туда, а экран выглядит уверенным. Официальная страница
                    верна всегда, потому что её ведёт правообладатель.
                    Турнира нет в таблице — ссылки нет: обещать нерабочий
                    адрес хуже, чем не обещать ничего. */}
                {broadcasts.get(fixture.sport_key) && (
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpact('light');
                      openLink(broadcasts.get(fixture.sport_key)!.url);
                    }}
                    className="mt-2 ml-[3.75rem] inline-flex items-center gap-1.5 text-brand-muted hover:text-brand-accent transition-colors text-[10.5px]"
                  >
                    <IconDeviceTvOld size={13} stroke={1.75} />
                    <span>
                      {t('matches.where_to_watch', {
                        source: broadcasts.get(fixture.sport_key)!.name,
                      })}
                    </span>
                  </button>
                )}

                <div className="mt-2 pl-[3.75rem]">
                  <PredictionRow
                    fixture={fixture}
                    existing={byFixture.get(fixture.id)}
                    onSaved={(saved) => {
                      setPredictions((prev) => [
                        saved,
                        ...prev.filter((p) => p.fixture_id !== saved.fixture_id),
                      ]);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
