import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { localDayKey, monthGrid, shiftMonth, type Horizon } from './monthCalendar';

interface Props {
  month: Date;
  onMonthChange: (month: Date) => void;
  /** Матчи ЭТОГО месяца. Порядок не важен: сетка считает по дням. */
  fixtures: { commence_at: string }[];
  horizon: Horizon;
  /** Выбранный день, `YYYY-MM-DD`, или null — «весь месяц». */
  selected: string | null;
  onSelect: (day: string | null) => void;
}

/**
 * Месяц расписания сеткой.
 *
 * ⚠️ ДВЕ ПУСТЫЕ КЛЕТКИ — ЭТО ДВА РАЗНЫХ УТВЕРЖДЕНИЯ, и весь смысл этого
 * компонента в том, чтобы они выглядели по-разному:
 *
 *   • день внутри расписанного отрезка без матчей — «матчей нет», обычная
 *     клетка с числом;
 *   • день за горизонтом публикации — «пока не знаем», клетка приглушена и
 *     нажать её нельзя.
 *
 * Провайдер публикует примерно на три недели вперёд. Нарисованный без этого
 * различия следующий месяц выглядел бы как «футбола не будет» — и это не
 * придирка к оформлению: игрок делает такой вывод один раз и не возвращается.
 *
 * ВРЕМЯ ЗРИТЕЛЯ, А НЕ СЕРВЕРА. Матч в 22:00 UTC — это сегодняшний вечер в
 * Мадриде и завтрашнее утро в Токио; какой это день, решается там, где стоит
 * зритель, поэтому и сетка, и ключи дней считаются по местным полям даты.
 */
export function MonthCalendar({
  month, onMonthChange, fixtures, horizon, selected, onSelect,
}: Props) {
  const { t, i18n } = useTranslation();

  const cells = useMemo(
    () => monthGrid(month, i18n.language, fixtures, horizon),
    [month, i18n.language, fixtures, horizon],
  );

  // Форматтеры дороги, а клеток сорок две — строить их на клетку значило бы
  // строить сорок два.
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }),
    [i18n.language],
  );
  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }),
    [i18n.language],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }),
    [i18n.language],
  );

  // Подписи столбцов берутся из ПЕРВОЙ НЕДЕЛИ САМОЙ СЕТКИ, а не из отдельного
  // списка: иначе появляется второе место, где решается, с какого дня
  // начинается неделя, и оно однажды разойдётся с первым.
  const weekdays = cells.slice(0, 7);

  const today = localDayKey(new Date());

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onMonthChange(shiftMonth(month, -1)); }}
          aria-label={t('matches.month_prev')}
          className="text-brand-muted hover:text-white transition-colors p-1"
        >
          <IconChevronLeft size={18} stroke={2} />
        </button>
        <span className="ds-display text-white text-sm font-bold capitalize">
          {monthFmt.format(month)}
        </span>
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onMonthChange(shiftMonth(month, 1)); }}
          aria-label={t('matches.month_next')}
          className="text-brand-muted hover:text-white transition-colors p-1"
        >
          <IconChevronRight size={18} stroke={2} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((cell) => (
          <span
            key={`wd-${cell.key}`}
            className="text-brand-muted/60 text-[9px] text-center uppercase tracking-wide py-0.5"
          >
            {weekdayFmt.format(cell.date)}
          </span>
        ))}

        {cells.map((cell) => {
          const isSelected = selected === cell.key;
          // Нажимать нечего у дня, про который мы ничего не знаем, и у чужого
          // месяца: и то и другое молча увело бы в пустой список.
          const pressable = cell.inMonth && cell.known;

          return (
            <button
              key={cell.key}
              type="button"
              disabled={!pressable}
              onClick={() => {
                hapticImpact('light');
                onSelect(isSelected ? null : cell.key);
              }}
              aria-label={`${dayFmt.format(cell.date)} — ${
                !cell.known
                  ? t('matches.day_unknown')
                  : cell.matches === 0
                    ? t('matches.day_none')
                    : t('matches.day_matches', { count: cell.matches })
              }`}
              aria-pressed={isSelected}
              className={[
                'relative aspect-square rounded-lg flex flex-col items-center justify-center',
                'text-[11px] tabular-nums transition-colors',
                !cell.inMonth
                  ? 'text-brand-muted/25'
                  : !cell.known
                    // «Не знаем» — приглушённая клетка в рамке из точек. Пустая
                    // клетка без рамки сказала бы «матчей нет», а это неправда.
                    ? 'text-brand-muted/30 border border-dashed border-brand-border/50'
                    : isSelected
                      ? 'bg-brand-accent text-black font-bold'
                      : cell.matches > 0
                        ? 'bg-brand-bg/60 text-white font-semibold hover:bg-brand-bg'
                        : 'text-brand-muted/70',
                cell.key === today && !isSelected ? 'ring-1 ring-brand-accent/60' : '',
              ].join(' ')}
            >
              <span>{cell.date.getDate()}</span>
              {/* Число матчей, а не точка: точка отвечает «есть», а вопрос у
                  человека, листающего календарь, — «сколько». */}
              {cell.inMonth && cell.known && cell.matches > 0 && (
                <span
                  className={
                    isSelected
                      ? 'text-[8px] leading-none text-black/70'
                      : 'text-[8px] leading-none text-brand-accent'
                  }
                >
                  {cell.matches}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ГОРИЗОНТ НАЗЫВАЕТСЯ ВСЛУХ. Приглушённых клеток недостаточно: их можно
          прочесть как оформление. Строка говорит прямо, докуда расписание
          известно, и тогда серые клетки читаются как «дальше пока никак», а
          не как «дальше ничего не будет». */}
      {horizon.publishedUntil && (
        <p className="text-brand-muted/70 text-[10px] leading-snug">
          {t('matches.published_until', {
            date: dayFmt.format(new Date(horizon.publishedUntil)),
          })}
        </p>
      )}
    </div>
  );
}
