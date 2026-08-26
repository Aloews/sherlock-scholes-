import { useTranslation } from 'react-i18next';
import type { SquadStrength as Strength } from './squadStrengthApi';

interface Props {
  strength: Strength;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Уровень состава двух команд — двумя полосами.
 *
 * ⚠️ ЭТО НЕ ПРОГНОЗ И НЕ «ФАВОРИТ». Шапка FixtureCard запрещает выделенную
 * сторону и всё, производное от коэффициентов. Здесь другое происхождение —
 * известность своих же карточек, а не букмекер, — но правило соблюдается по
 * сути, а не по букве: обе стороны нарисованы ОДИНАКОВО, порядок всегда
 * «хозяева, потом гости» и никогда не переставляется по величине, значка
 * фаворита нет. Читатель сравнивает сам.
 *
 * ⚠️ ЧИСЛО ПОДПИСАНО ТЕМ, ЧТО ОНО ЕСТЬ. Не «сила», а «известность состава»:
 * `cards.fame` построена по просмотрам в википедии, и ветеран на излёте
 * известнее сильного дебютанта. Рядом стоит глубина — по скольким игрокам
 * посчитано, — потому что оценка по пяти и по одиннадцати это разные
 * утверждения, и прятать разницу нечестно.
 */
export function SquadStrength({ strength, homeTeam, awayTeam }: Props) {
  const { t } = useTranslation();
  const { home_fame, away_fame, depth } = strength;

  // Полосы рисуются от общей шкалы 0..100, а не «относительно большего»:
  // растяжка до максимума превратила бы отрыв в 3 пункта в разгром во всю
  // ширину. Известность и так уже нормирована на сотню — второй раз не надо.
  const row = (team: string, fame: number) => (
    <div className="flex items-center gap-2">
      <span className="text-brand-muted text-[10.5px] w-[4.5rem] shrink-0 truncate">{team}</span>
      <span className="h-1.5 flex-1 rounded-full bg-brand-border overflow-hidden">
        <span
          className="block h-full rounded-full bg-brand-accent"
          style={{ width: `${Math.max(0, Math.min(100, fame))}%` }}
        />
      </span>
      <span className="text-white text-[10.5px] tabular-nums w-7 text-right shrink-0">
        {Math.round(fame)}
      </span>
    </div>
  );

  return (
    <div className="mt-2 space-y-1">
      <p className="text-brand-muted text-[10px] uppercase tracking-wider">
        {t('matches.squad_level')}
        <span className="normal-case">{' · '}{t('matches.squad_depth', { count: depth })}</span>
      </p>
      {row(homeTeam, home_fame)}
      {row(awayTeam, away_fame)}
    </div>
  );
}
