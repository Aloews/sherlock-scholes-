import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import {
  fetchCareerTotals, fetchClubCareer,
  type CareerTotalsRow, type ClubCareerRow,
} from '@/features/ratings/ratingsApi';

/**
 * Статистика карьеры в досье — числами, а не датами.
 *
 * Владелец: «Отображай статистику игрока очень очень красиво, сейчас это
 * просто даты, ничего не понятно».
 *
 * ⚠️ ЧТО БЫЛО НЕ ТАК, И ЭТО НЕ ВОПРОС ОФОРМЛЕНИЯ. Блок «Собранная статистика»
 * показывал строки вида «Премьер-лига · 12.08.2025 — 30.05.2026 · 24 · 7 · 3».
 * Первое, что видит глаз, — две даты, то есть период сбора НАШИМ конвейером;
 * числа стоят третьими и без подписей. Человек спрашивает «сколько он забил»,
 * а получает «когда мы это собирали».
 *
 * Здесь наоборот: сперва ЧЕТЫРЕ ЧИСЛА КАРЬЕРЫ крупно и подписанные, потом
 * клубы — каждый со своими матчами, голами и долей сыгранных минут. Даты
 * остались, но стали подписью к клубу, а не заголовком строки.
 *
 * ⚠️ ПОЛОСА — ЭТО ДОЛЯ ОТ МАКСИМУМА ЭТОГО ЖЕ ИГРОКА, а не от какой-то общей
 * шкалы. Она отвечает на вопрос «где он играл больше всего», и другого смысла
 * у неё нет; сравнивать по ней двух разных игроков нельзя, поэтому и подписи
 * «из 100%» нигде нет.
 */
export function CareerStats({ cardId }: { cardId: string }) {
  const { t, i18n } = useTranslation();
  const [totals, setTotals] = useState<LoadState<CareerTotalsRow[]>>(LOADING);
  const [clubs, setClubs] = useState<LoadState<ClubCareerRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setTotals(LOADING);
    setClubs(LOADING);
    void fetchCareerTotals(cardId).then((r) => { if (!cancelled) setTotals(r); });
    void fetchClubCareer(cardId).then((r) => { if (!cancelled) setClubs(r); });
    return () => { cancelled = true; };
  }, [cardId]);

  const total = totals.status === 'ok' ? totals.data[0] ?? null : null;
  const rows = clubs.status === 'ok' ? clubs.data : [];

  // ⚠️ НЕТ МАТЧЕЙ — НЕТ БЛОКА. Ноль матчей и «мы не собрали его лигу»
  // выглядят одинаково, а значат разное; пустая таблица утверждала бы первое.
  if (!total || total.club_apps === 0) return null;

  const n = new Intl.NumberFormat(i18n.language);
  const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));

  return (
    <div className="space-y-3">
      {/* Четыре числа карьеры — то, ради чего сюда смотрят. */}
      <div className="grid grid-cols-4 gap-1.5">
        <Tile label={t('career.matches')} value={n.format(total.club_apps)} />
        <Tile label={t('career.goals')} value={n.format(total.club_goals)} accent />
        <Tile label={t('career.assists')} value={n.format(total.club_assists)} />
        <Tile label={t('career.minutes')} value={n.format(total.club_minutes)} />
      </div>

      {/* Сборная — отдельной строкой: складывать её с клубной суммой нельзя. */}
      {total.national_team && total.national_apps > 0 && (
        <p className="text-[11.5px] text-brand-muted">
          {t('career.national', {
            team: total.national_team,
            apps: total.national_apps,
            goals: total.national_goals,
          })}
        </p>
      )}

      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.club_id} className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] text-white truncate flex-1 min-w-0">
                {r.club_name}
              </span>
              <span className="text-[10.5px] text-brand-muted tabular-nums shrink-0">
                {r.season_from === r.season_to
                  ? r.season_from
                  : `${r.season_from}–${r.season_to}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Доля сыгранных минут — где он играл больше всего. */}
              <div className="h-1.5 flex-1 rounded-full bg-brand-bg overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-accent/70"
                  style={{ width: `${Math.round((r.minutes / maxMinutes) * 100)}%` }}
                />
              </div>
              <span className="text-[10.5px] text-brand-muted tabular-nums shrink-0">
                {t('career.club_line', {
                  matches: r.apps, goals: r.goals, assists: r.assists,
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, accent = false }: {
  label: string; value: string; accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-brand-bg/60 border border-brand-border px-2 py-2 text-center">
      <p className={`ds-display text-[15px] font-bold tabular-nums leading-none ${
        accent ? 'text-brand-accent' : 'text-white'
      }`}>
        {value}
      </p>
      <p className="text-brand-muted text-[9px] uppercase tracking-wide mt-1 truncate">
        {label}
      </p>
    </div>
  );
}
