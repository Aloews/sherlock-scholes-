import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconShieldHalf } from '@tabler/icons-react';
import {
  fetchLeagues, fetchLeagueTable,
  type LeagueRow, type LeagueTableRow,
} from '@/features/clubs/clubsApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { Chip } from '@/shared/ui/Chip';
import { longDateFormat } from '@/shared/lib/dateFormat';

/**
 * Турнирная таблица.
 *
 * ⚠️ ЧЕСТНОСТЬ ЗДЕСЬ ДЕРЖИТСЯ НА КОЛОНКЕ «И», И ОНА ПЕРВАЯ НЕ ИЗ ТРАДИЦИИ.
 * Матчи собраны из статистики игроков — в них попали только те, где сыграл
 * кто-то из оцифрованных. Замер по сезону 2026/27: в РПЛ у команд 5–6 матчей,
 * в АПЛ 1–2 — это настоящие числа сыгранного, потому что европейский сезон
 * только начался. Но убедиться в этом можно единственным способом: увидеть
 * «И». Строка с меньшим числом матчей должна бросаться в глаза сама, без
 * подписи, которую никто не читает.
 *
 * ⚠️ ГРАНИЦА СЕЗОНА ВЫВЕДЕНА ИЗ ДАННЫХ, а не взята из календаря — календаря у
 * нас нет. Летний перерыв виден в расписании сам: последний разрыв длиннее
 * тридцати дней и есть начало сезона. Дата стоит под таблицей, чтобы «за
 * сезон» не пришлось понимать на веру.
 */
export function LeagueTableScreen() {
  const { tournament: fromPath } = useParams<{ tournament: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [leagues, setLeagues] = useState<LoadState<LeagueRow[]>>(LOADING);
  const selected = fromPath ? decodeURIComponent(fromPath) : (params.get('league') ?? '');
  const [rows, setRows] = useState<LoadState<LeagueTableRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    void fetchLeagues(lang).then((r) => { if (!cancelled) setLeagues(r); });
    return () => { cancelled = true; };
  }, [lang]);

  // Без выбранного турнира открываем первый из списка — он самый полный по
  // числу матчей. Экран со списком лиг и пустотой под ним требовал бы лишнего
  // касания, чтобы увидеть хоть что-то.
  const list = leagues.status === 'ok' ? leagues.data : [];
  const current = selected || list[0]?.tournament || '';

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setRows(LOADING);
    void fetchLeagueTable(current, lang).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [current, lang]);

  const season = list.find((l) => l.tournament === current)?.season_start ?? null;
  const dateFmt = longDateFormat(lang);
  const table = rows.status === 'ok' ? rows.data : [];

  const outcomeClass = (o: string) =>
    o === 'w' ? 'bg-brand-accent text-black'
      : o === 'd' ? 'bg-brand-border text-white'
        : 'bg-brand-bg text-brand-muted';

  return (
    <div className="min-h-screen bg-brand-bg pb-24 ds-screen">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={1.5} />
          </button>
          <h1 className="ds-display text-white text-lg font-bold">{t('table.title')}</h1>
        </div>

        <div className="-mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-0.5">
            {list.map((l) => (
              <Chip
                key={l.tournament}
                label={l.tournament}
                selected={l.tournament === current}
                onClick={() => {
                  hapticImpact('light');
                  const next = new URLSearchParams(params);
                  next.set('league', l.tournament);
                  setParams(next, { replace: true });
                }}
              />
            ))}
          </div>
        </div>

        {(leagues.status === 'loading' || rows.status === 'loading') && (
          <p className="text-brand-muted text-sm text-center py-8">{t('table.loading')}</p>
        )}

        {(leagues.status === 'error' || rows.status === 'error') && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('table.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">
              {leagues.status === 'error' ? leagues.code : rows.status === 'error' ? rows.code : ''}
            </p>
          </div>
        )}

        {rows.status === 'ok' && table.length === 0 && (
          <p className="text-brand-muted text-sm text-center py-8">{t('table.empty')}</p>
        )}

        {table.length > 0 && (
          <>
            <div className="-mx-4 px-4 overflow-x-auto">
              <table className="w-max min-w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-brand-muted text-[10.5px] uppercase tracking-wide">
                    <th className="text-left font-medium pl-2 w-6">#</th>
                    <th className="text-left font-medium pr-3">{t('table.col_club')}</th>
                    {/* «И» первая после названия: неполнота строки обязана
                        быть видна сразу, без подписи. */}
                    <th className="text-right font-medium px-1.5">{t('table.col_played')}</th>
                    <th className="text-right font-medium px-1.5">{t('table.col_w')}</th>
                    <th className="text-right font-medium px-1.5">{t('table.col_d')}</th>
                    <th className="text-right font-medium px-1.5">{t('table.col_l')}</th>
                    <th className="text-right font-medium px-1.5">{t('table.col_goals')}</th>
                    <th className="text-right font-medium px-1.5">{t('table.col_diff')}</th>
                    <th className="text-right font-medium px-2">{t('table.col_points')}</th>
                    <th className="text-left font-medium px-2">{t('table.col_form')}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => (
                    <tr
                      key={r.club_key}
                      onClick={() => navigate(`/club/${encodeURIComponent(r.club_key)}`)}
                      className="ds-panel bg-brand-surface cursor-pointer active:opacity-70 transition-opacity"
                    >
                      <td className="pl-2 py-2 rounded-l-xl text-brand-muted tabular-nums">{r.place}</td>
                      <td className="pr-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.crest_url ? (
                            <img src={r.crest_url} alt="" className="w-6 h-6 rounded object-contain bg-brand-bg shrink-0" loading="lazy" />
                          ) : (
                            <IconShieldHalf size={14} stroke={1.5} className="text-brand-muted shrink-0" />
                          )}
                          <span className="text-white truncate max-w-[8.5rem]">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-1.5 text-right tabular-nums text-white">{r.played}</td>
                      <td className="px-1.5 text-right tabular-nums text-brand-muted">{r.wins}</td>
                      <td className="px-1.5 text-right tabular-nums text-brand-muted">{r.draws}</td>
                      <td className="px-1.5 text-right tabular-nums text-brand-muted">{r.losses}</td>
                      <td className="px-1.5 text-right tabular-nums text-brand-muted whitespace-nowrap">
                        {r.goals_for}:{r.goals_against}
                      </td>
                      <td className="px-1.5 text-right tabular-nums text-brand-muted">
                        {r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}
                      </td>
                      <td className="px-2 text-right">
                        <span className="ds-display text-white font-bold tabular-nums">{r.points}</span>
                      </td>
                      <td className="px-2 py-2 rounded-r-xl">
                        <div className="flex gap-0.5">
                          {(r.form ?? '').split('').map((o, i) => (
                            <span
                              key={i}
                              className={`w-4 h-4 rounded-sm grid place-items-center text-[9px] font-bold ${outcomeClass(o)}`}
                            >
                              {t(`club.outcome_${o}`)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Откуда взялся «сезон» и почему матчей может быть мало. Без этой
                строки таблица выдаёт себя за полную, а она собрана из
                статистики игроков. */}
            <p className="text-brand-muted/70 text-[11px]">
              {season && t('table.since', { date: dateFmt.format(new Date(season)) })}
              {' · '}
              {t('table.source_note')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
