import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconShieldHalf } from '@tabler/icons-react';
import {
  fetchClubProfile, fetchClubSquad, fetchClubMatches, fetchClubFixtures,
  CLUB_WINDOWS, type ClubWindow,
  type ClubProfile, type ClubSquadRow, type ClubMatchRow, type ClubFixtureRow,
} from '@/features/clubs/clubsApi';
import {
  formFrom, goalDiff, pointsFrom, winRate, perMatch, hasEnoughForRates,
} from '@/features/clubs/clubStats';
import { ClubSquadTable } from '@/features/clubs/ClubSquadTable';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { Chip } from '@/shared/ui/Chip';
import { longDateFormat } from '@/shared/lib/dateFormat';

/**
 * Экран команды: кто это, как идут дела, кто играет и что дальше.
 *
 * ⚠️ ЧЕТЫРЕ ЗАПРОСА, А НЕ ОДИН Promise.all. Разделы независимы, и экран,
 * ждущий по самому медленному, уже стоил этому проекту отдельного разбора
 * (DigestScreen, docs/MAP.md §9). Состав приходит когда придёт, матчи — когда
 * придут они.
 *
 * ⚠️ ОКНО НАЗЫВАЕТСЯ ЧИСЛОМ ДНЕЙ, А НЕ «СЕЗОНОМ». Сезон у каждой лиги свой, а
 * календаря сезонов у нас нет вовсе. «За 365 дней» — правда; «в сезоне» было
 * бы обещанием, которого данные не выполняют.
 *
 * ⚠️ ЧТО ЗДЕСЬ НЕ ТУРНИРНАЯ ТАБЛИЦА. Матчи собраны из статистики игроков —
 * значит, в них попали только те, где сыграл кто-то из оцифрованных. Это не
 * весь турнир. Поэтому под числами стоит, сколько матчей их дало, и слово
 * «место» не употребляется нигде.
 */
export function ClubScreen() {
  const { key = '' } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [days, setDays] = useState<ClubWindow>(365);
  const [profile, setProfile] = useState<LoadState<ClubProfile | null>>(LOADING);
  const [squad, setSquad] = useState<LoadState<ClubSquadRow[]>>(LOADING);
  const [matches, setMatches] = useState<LoadState<ClubMatchRow[]>>(LOADING);
  const [fixtures, setFixtures] = useState<LoadState<ClubFixtureRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setProfile(LOADING);
    setSquad(LOADING);
    void fetchClubProfile(key, lang, days).then((r) => { if (!cancelled) setProfile(r); });
    void fetchClubSquad(key, lang, days).then((r) => { if (!cancelled) setSquad(r); });
    return () => { cancelled = true; };
  }, [key, lang, days]);

  // Матчи и расписание от окна не зависят: список последних матчей — это
  // список последних матчей, а не выборка за период.
  useEffect(() => {
    let cancelled = false;
    setMatches(LOADING);
    setFixtures(LOADING);
    void fetchClubMatches(key, lang).then((r) => { if (!cancelled) setMatches(r); });
    void fetchClubFixtures(key, lang).then((r) => { if (!cancelled) setFixtures(r); });
    return () => { cancelled = true; };
  }, [key, lang]);

  const dateFmt = longDateFormat(lang);
  const p = profile.status === 'ok' ? profile.data : null;
  const matchRows = matches.status === 'ok' ? matches.data : [];
  const form = formFrom(matchRows);

  const outcomeClass = (o: string) =>
    o === 'w' ? 'bg-brand-accent text-black'
      : o === 'd' ? 'bg-brand-border text-white'
        : 'bg-brand-surface text-brand-muted border border-brand-border';

  return (
    <div className="min-h-screen bg-brand-bg pb-24 ds-screen">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={1.5} />
          </button>
          <h1 className="ds-display text-white text-lg font-bold truncate">
            {p?.name ?? t('club.title')}
          </h1>
        </div>

        {profile.status === 'loading' && (
          <p className="text-brand-muted text-sm text-center py-8">{t('club.loading')}</p>
        )}

        {profile.status === 'error' && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('club.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">{profile.code}</p>
          </div>
        )}

        {/* Команды нет в справочнике — это ответ, а не поломка, и звучать он
            должен иначе, чем ошибка загрузки. */}
        {profile.status === 'ok' && !p && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center">
            <p className="text-brand-muted text-sm">{t('club.not_found')}</p>
          </div>
        )}

        {p && (
          <>
            {/* Шапка: эмблема, страна, лига */}
            <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 flex items-center gap-3">
              {p.crest_url ? (
                <img
                  src={p.crest_url}
                  alt=""
                  className="w-14 h-14 rounded-xl object-contain bg-brand-bg shrink-0"
                  loading="lazy"
                />
              ) : (
                <span className="w-14 h-14 rounded-xl bg-brand-bg shrink-0 grid place-items-center">
                  <IconShieldHalf size={26} stroke={1.5} className="text-brand-muted" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white font-medium truncate">{p.name}</p>
                <p className="text-brand-muted text-[11px] truncate">
                  {[p.country, p.league].filter(Boolean).join(' · ') || t('club.league_unknown')}
                </p>
                {p.squad > 0 && (
                  <p className="text-brand-muted/70 text-[10.5px]">
                    {t('club.squad_size', { count: p.squad })}
                  </p>
                )}
              </div>

              {/* УРОВЕНЬ КОМАНДЫ — та же шкала 0–100, что у игрока. До этого у
                  клуба числа не было вовсе, и сравнить команду с футболистом
                  было нечем. Место в лиге рядом, потому что это РАЗНЫЕ ответы:
                  таблица говорит «как идут дела в этом сезоне», рейтинг —
                  «насколько команда сильна вообще», и первое место в слабой
                  лиге со средним рейтингом не противоречие. */}
              {p.level != null && (
                <button
                  type="button"
                  onClick={() => {
                    if (!p.league) return;
                    hapticImpact('light');
                    navigate(`/table/${encodeURIComponent(p.league)}`);
                  }}
                  disabled={!p.league}
                  className="text-right shrink-0 disabled:opacity-100"
                >
                  <p className="ds-display text-brand-accent text-2xl font-black tabular-nums leading-none">
                    {p.level}
                  </p>
                  <p className="text-brand-muted/70 text-[9.5px] uppercase tracking-wide">
                    {t('club.rating')}
                  </p>
                  {p.league_place != null && (
                    <p className="text-brand-muted text-[10.5px] tabular-nums">
                      {t('club.place', { n: p.league_place })}
                    </p>
                  )}
                </button>
              )}
            </div>

            <div className="-mx-4 px-4 overflow-x-auto">
              <div className="flex gap-1.5 w-max pb-0.5">
                {CLUB_WINDOWS.map((w) => (
                  <Chip
                    key={w}
                    label={t(`club.window_${w}`)}
                    selected={days === w}
                    onClick={() => { hapticImpact('light'); setDays(w); }}
                  />
                ))}
              </div>
            </div>

            {/* Сводка. Матчей нет — раздела нет: пустая таблица результатов
                утверждала бы, что команда не играла. */}
            {p.matches > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label={t('club.stat_record')} value={`${p.wins}-${p.draws}-${p.losses}`} />
                  <Stat label={t('club.stat_goals')} value={`${p.goals_for}:${p.goals_against}`} />
                  <Stat label={t('club.stat_diff')} value={goalDiff(p)} />
                  <Stat label={t('club.stat_points')} value={String(pointsFrom(p))} />
                  <Stat
                    label={t('club.stat_winrate')}
                    /* Проценты только с трёх матчей: один выигранный матч
                       иначе даёт «100% побед», и выглядит это убедительно. */
                    value={hasEnoughForRates(p) ? `${winRate(p)}%` : '—'}
                  />
                  <Stat
                    label={t('club.stat_gpm')}
                    value={hasEnoughForRates(p) ? (perMatch(p.goals_for, p.matches) ?? '—') : '—'}
                  />
                </div>

                {form.length > 0 && (
                  <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-2">
                    <span className="text-brand-muted text-[11px] shrink-0">{t('club.form')}</span>
                    <div className="flex gap-1">
                      {form.map((o, i) => (
                        <span
                          key={i}
                          className={`w-6 h-6 rounded-md grid place-items-center text-[11px] font-bold ${outcomeClass(o)}`}
                        >
                          {t(`club.outcome_${o}`)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Из скольких матчей это посчитано — без этой строки числа
                    читались бы как турнирная таблица, а они не она. */}
                <p className="text-brand-muted/70 text-[11px]">
                  {t('club.based_on', { count: p.matches })}
                  {p.first_match && ` · ${t('club.since', { date: dateFmt.format(new Date(p.first_match)) })}`}
                </p>

                {/* ⚠️ ОГОВОРКА ПРО ЛИГУ-ОСТРОВ, и она не косметическая. Рейтинг
                    сравним между лигами ровно настолько, насколько лиги играют
                    друг с другом: у саудовской 13 межлиговых матчей из 222.
                    Без этой строки её середняк стоит рядом с ПСЖ и выглядит
                    совершенно нормально. */}
                {p.league_weight != null && p.league_weight < 0.8 && (
                  <p className="text-brand-muted/70 text-[11px]">
                    {t('club.league_isolated', { pct: Math.round(p.league_weight * 100) })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-brand-muted text-sm">{t('club.no_matches')}</p>
            )}

            {/* Состав */}
            <section className="space-y-2">
              <h2 className="ds-display text-white text-base font-bold">{t('club.squad')}</h2>
              {squad.status === 'loading' && (
                <p className="text-brand-muted text-sm py-4">{t('club.loading')}</p>
              )}
              {squad.status === 'error' && (
                <p className="text-brand-muted text-sm py-4">{t('club.failed')}</p>
              )}
              {squad.status === 'ok' && (
                <ClubSquadTable
                  rows={squad.data}
                  onOpenCard={(cardId) => navigate(`/collection?card=${cardId}`)}
                />
              )}
            </section>

            {/* Последние матчи */}
            {matchRows.length > 0 && (
              <section className="space-y-2">
                <h2 className="ds-display text-white text-base font-bold">{t('club.recent')}</h2>
                <div className="space-y-1.5">
                  {matchRows.slice(0, 10).map((m) => (
                    <div
                      key={`${m.match_date}-${m.opponent_key}`}
                      className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2 flex items-center gap-3"
                    >
                      <span
                        className={`w-6 h-6 rounded-md grid place-items-center text-[11px] font-bold shrink-0 ${m.outcome ? outcomeClass(m.outcome) : 'bg-brand-bg text-brand-muted'}`}
                      >
                        {m.outcome ? t(`club.outcome_${m.outcome}`) : '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm truncate">
                          {/* Дома или в гостях — иначе счёт 2:1 не читается */}
                          {m.home ? t('club.vs_home', { team: m.opponent })
                            : t('club.vs_away', { team: m.opponent })}
                        </p>
                        <p className="text-brand-muted text-[10.5px] truncate">
                          {[dateFmt.format(new Date(m.match_date)), m.tournament].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0">
                        {m.goals_for ?? '—'}:{m.goals_against ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Ближайшие матчи — ДРУГОЙ источник, поэтому отдельный раздел */}
            {fixtures.status === 'ok' && fixtures.data.length > 0 && (
              <section className="space-y-2">
                <h2 className="ds-display text-white text-base font-bold">{t('club.upcoming')}</h2>
                <div className="space-y-1.5">
                  {fixtures.data.map((f) => (
                    <div
                      key={f.fixture_id}
                      className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2 flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm truncate">
                          {f.home ? t('club.vs_home', { team: f.opponent })
                            : t('club.vs_away', { team: f.opponent })}
                        </p>
                        <p className="text-brand-muted text-[10.5px]">
                          {dateFmt.format(new Date(f.commence_at))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
      <p className="text-brand-muted text-[10px] uppercase tracking-wide truncate">{label}</p>
      <p className="ds-display text-white text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}
