import type { ReactNode } from 'react';

/**
 * Строка статистики: подпись слева, числа справа — ОДНА на все экраны.
 *
 * Владелец: «статистику в карточке игрока и в финальном экране элиаса нужно
 * улучшить и привести к одному виду».
 *
 * ⚠️ ВИДЫ И ПРАВДА БЫЛИ РАЗНЫЕ, и это не придирка к вёрстке. В досье игрока
 * статистика — строки с числами по турнирам: «матчи, голы, передачи»,
 * выровненные моноширинно. В финале элиаса чисел не было ВООБЩЕ: команды
 * показывались кружками раундов, а игроки — только именами и цветной точкой.
 * То есть «привести к одному виду» здесь значит не перекрасить, а показать
 * числа там, где их не показывали.
 *
 * ⚠️ `tabular-nums` — НЕ УКРАШЕНИЕ. Без него «12» и «7» в соседних строках
 * стоят на разной ширине, и столбец чисел перестаёт читаться сверху вниз —
 * ровно то, ради чего статистику и смотрят.
 */
export function StatLine({ label, sub, value, accent = false }: {
  label: string;
  /** Вторая строка под подписью: период, турнир, что угодно уточняющее. */
  sub?: ReactNode;
  /** Числа. Строкой, а не числом: «12 · 3 · 1» это тоже значение. */
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-brand-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] text-white/90 truncate">{label}</p>
        {sub != null && <p className="text-[11px] text-brand-muted">{sub}</p>}
      </div>
      <span className={`text-[11.5px] tabular-nums shrink-0 self-center ${
        accent ? 'text-brand-accent font-semibold' : 'text-brand-muted'
      }`}>
        {value}
      </span>
    </div>
  );
}
