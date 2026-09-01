import { useTranslation } from 'react-i18next';
import type { TeamRating } from './squadStrengthApi';

interface Props {
  rating: TeamRating;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Рейтинг двух команд матча — двумя полосами.
 *
 * ⚠️ ЭТО НЕ ПРОГНОЗ И НЕ «ФАВОРИТ». Шапка FixtureCard запрещает выделенную
 * сторону и всё, производное от коэффициентов. Здесь другое происхождение —
 * уровни своих же карточек и результаты матчей, а не букмекер, — но правило
 * соблюдается по сути, а не по букве: обе стороны нарисованы ОДИНАКОВО,
 * порядок всегда «хозяева, потом гости» и никогда не переставляется по
 * величине, значка фаворита нет. Читатель сравнивает сам.
 *
 * ⚠️ ЧИСЛО ПОДПИСАНО ТЕМ, ЧТО ОНО ЕСТЬ. Рейтинг собран из УРОВНЕЙ ИГРОКОВ
 * (player_level — половина известности, половина отдачи за матч) и, где есть,
 * из формы команды по результатам. Рядом стоит глубина: оценка по пяти
 * игрокам и по одиннадцати — разные утверждения, и прятать разницу нечестно.
 *
 * ⚠️ МЕЖДУ ЛИГАМИ НЕ СРАВНИВАЕТСЯ. Уровень игрока наполовину построен на
 * известности, а она сильно зависит от языка и внимания: у РПЛ выходит 30–40
 * там, где у АПЛ 68–86. Внутри матча это не мешает — обе команды почти всегда
 * из одной лиги, — но складывать эти числа в общую таблицу лиг нельзя.
 */
export function SquadStrength({ rating, homeTeam, awayTeam }: Props) {
  const { t } = useTranslation();
  const { home_rating, away_rating, home_squad_level, away_squad_level, depth, basis } = rating;

  // Полосы рисуются от общей шкалы 0..100, а не «относительно большего»:
  // растяжка до максимума превратила бы отрыв в 3 пункта в разгром во всю
  // ширину. Уровень и так нормирован на сотню — второй раз не надо.
  const row = (team: string, value: number, squad: number) => (
    <div className="flex items-center gap-2">
      <span className="text-brand-muted text-[10.5px] w-[4.5rem] shrink-0 truncate">{team}</span>
      <span className="h-1.5 flex-1 rounded-full bg-brand-border overflow-hidden">
        <span
          className="block h-full rounded-full bg-brand-accent"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      {/* Состав отдельным числом рядом: рейтинг собран из него и из формы, и
          если показать только итог, непонятно, что именно его двигает. */}
      <span className="text-brand-muted text-[9.5px] tabular-nums w-6 text-right shrink-0">
        {Math.round(squad)}
      </span>
      <span className="text-white text-[10.5px] tabular-nums w-7 text-right shrink-0">
        {Math.round(value)}
      </span>
    </div>
  );

  return (
    <div className="mt-2 space-y-1">
      <p className="text-brand-muted text-[10px] uppercase tracking-wider">
        {t('matches.team_rating')}
        <span className="normal-case">
          {' · '}{t('matches.squad_depth', { count: depth })}
          {/* Из чего собрано. При 'squad' формы нет — матчей у команды мало, —
              и выдавать состав за полный рейтинг значило бы объяснять число
              не тем. */}
          {basis === 'squad' && ` · ${t('matches.rating_squad_only')}`}
        </span>
      </p>
      {row(homeTeam, home_rating, home_squad_level)}
      {row(awayTeam, away_rating, away_squad_level)}
    </div>
  );
}
