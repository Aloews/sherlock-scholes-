// Полный состав клуба со стоимостью.
//
// ⚠️ ЭТО НЕ ClubSquadTable. Та показывает состав КОЛОДЫ — только тех, у кого
// есть карточка, зато с матчами и минутами. Здесь состав МИРА: у «Реала» 27
// игроков, а карточек из них меньше половины. Заводить недостающим голые
// карточки нельзя — колода уже портилась так, — поэтому строка без карточки
// просто не кликается.
//
// ⚠️ ИСТОЧНИК НАЗЫВАЕТСЯ РЯДОМ С ЧИСЛАМИ. Состав и стоимости принадлежат
// Transfermarkt; маскировать происхождение данных нельзя.
import { useTranslation } from 'react-i18next';
import { formatEur } from '@/shared/lib/money';
import { isoToFlag } from '@/shared/lib/flag';
import type { ClubRosterRow } from './clubsApi';

export function ClubRosterTable({
  rows,
  onOpenCard,
}: {
  rows: ClubRosterRow[];
  onOpenCard: (cardId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const value = formatEur(r.market_value_eur, lang);
        const clickable = r.card_id != null;
        const flag = isoToFlag(r.nationality);
        return (
          <button
            key={r.tm_player_id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onOpenCard(r.card_id!)}
            className={`ds-panel w-full flex items-center gap-2.5 bg-brand-surface border
                        border-brand-border rounded-xl px-2.5 py-2 text-left
                        ${clickable ? 'hover:border-brand-accent transition-colors' : 'cursor-default'}`}
          >
            <span className="w-6 shrink-0 text-center text-[11px] tabular-nums text-brand-muted">
              {r.shirt_number ?? '—'}
            </span>
            {r.photo_url ? (
              <img
                src={r.photo_url}
                alt=""
                className="w-7 h-7 rounded-full object-cover shrink-0 bg-brand-border"
              />
            ) : (
              <span className="w-7 h-7 rounded-full bg-brand-border shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] text-white truncate">
                {flag ? `${flag} ` : ''}{r.name}
              </span>
              {r.player_position && (
                <span className="block text-[9.5px] text-brand-muted truncate">
                  {r.player_position}
                </span>
              )}
            </span>
            {/* Прочерк, а не «€0»: у источника оценки может не быть вовсе, и
                ноль читался бы как «ничего не стоит». */}
            <span className="shrink-0 text-[12px] font-bold text-white tabular-nums">
              {value ?? '—'}
            </span>
          </button>
        );
      })}
      <p className="text-[9.5px] text-brand-muted/70 pt-1">
        {t('club.roster_source', { source: 'Transfermarkt' })}
      </p>
    </div>
  );
}
