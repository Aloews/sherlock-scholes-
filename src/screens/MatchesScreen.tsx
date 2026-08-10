import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBallFootball } from '@tabler/icons-react';
import { fetchUpcomingFixtures, groupByDay, type Fixture } from '@/features/fixtures/fixturesApi';
import { leagueKey, readableSportKey } from '@/features/fixtures/leagues';
import { hapticImpact } from '@/shared/lib/telegram';

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchUpcomingFixtures();
      if (!cancelled) setFixtures(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => groupByDay(fixtures ?? []), [fixtures]);

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
        {fixtures === null && (
          <p className="text-brand-muted text-sm text-center py-8">{t('matches.loading')}</p>
        )}

        {fixtures !== null && fixtures.length === 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center">
            <IconBallFootball size={28} stroke={1.5} className="mx-auto text-brand-muted mb-2" />
            <p className="text-brand-muted text-sm">{t('matches.empty')}</p>
          </div>
        )}

        {days.map(({ day, fixtures: list }) => (
          <div key={day} className="space-y-2">
            <p className="text-brand-muted text-xs uppercase tracking-wider">{dayLabel(day)}</p>

            {list.map((fixture) => (
              <div
                key={fixture.id}
                className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3"
              >
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
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
