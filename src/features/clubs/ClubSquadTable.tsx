import { useTranslation } from 'react-i18next';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import type { ClubSquadRow } from './clubsApi';

interface ClubSquadTableProps {
  rows: ClubSquadRow[];
  /** Открыть досье игрока. Строка без обработчика не притворяется кнопкой. */
  onOpenCard?: (cardId: string) => void;
}

/**
 * Состав со статистикой по каждому — то, ради чего всё остальное.
 *
 * ⚠️ ПОКАЗЫВАЮТСЯ ВСЕ, БЕЗ ОБРЕЗКИ. В заявке клуба под сорок человек, и
 * состав, обрезанный до одиннадцати, отвечает на вопрос «кто основной»,
 * которого никто не задавал, вместо заданного «кто в команде». Порядок задаёт
 * SQL — по отдаче в окне, потом по матчам, — то есть играющие всё равно
 * сверху, а остальные всё равно видны.
 *
 * ⚠️ ТАБЛИЦА ЕЗДИТ ВБОК ВНУТРИ СЕБЯ, а не растягивает страницу. Колонок семь,
 * телефон узкий, и горизонтальная прокрутка ВСЕГО экрана ломает вертикальную:
 * палец, ведущий список вниз, уводит его вбок.
 *
 * ⚠️ ПРОЧЕРК, А НЕ НОЛЬ, У МИНУТ. Минуты есть только у sports.ru; ESPN их не
 * отдаёт вовсе — его subbedIn/subbedOut булевы. Ноль на этом месте — не
 * «сыграл ноль минут», а «мы не знаем», и разница видна игроку.
 */
export function ClubSquadTable({ rows, onOpenCard }: ClubSquadTableProps) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <p className="text-brand-muted text-sm text-center py-6">{t('club.squad_empty')}</p>
    );
  }

  return (
    <div className="-mx-4 px-4 overflow-x-auto">
      <table className="w-max min-w-full text-sm border-separate border-spacing-y-1">
        <thead>
          <tr className="text-brand-muted text-[10.5px] uppercase tracking-wide">
            <th className="text-left font-medium pl-2 pr-3">{t('club.col_player')}</th>
            <th className="text-right font-medium px-2">{t('club.col_matches')}</th>
            <th className="text-right font-medium px-2">{t('club.col_minutes')}</th>
            <th className="text-right font-medium px-2">{t('club.col_goals')}</th>
            <th className="text-right font-medium px-2">{t('club.col_assists')}</th>
            <th className="text-right font-medium px-2">{t('club.col_cards')}</th>
            <th className="text-right font-medium px-2 pr-2">{t('club.col_points')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.card_id}
              onClick={onOpenCard ? () => onOpenCard(r.card_id) : undefined}
              className={
                'ds-panel bg-brand-surface ' +
                (onOpenCard ? 'cursor-pointer active:opacity-70 transition-opacity' : '')
              }
            >
              <td className="pl-2 pr-3 py-2 rounded-l-xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  {r.photo_url ? (
                    <PlayerPhoto src={r.photo_url} className="w-8 h-8 rounded-full shrink-0 bg-brand-bg" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-brand-bg shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-white truncate max-w-[9.5rem]">{r.name}</p>
                    {(r.player_position || r.shirt_number != null) && (
                      <p className="text-brand-muted text-[10.5px] truncate">
                        {[
                          r.shirt_number != null ? `#${r.shirt_number}` : null,
                          r.player_position,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-2 text-right tabular-nums text-white">{r.matches}</td>
              {/* Прочерк — «не знаем», ноль был бы «не играл». */}
              <td className="px-2 text-right tabular-nums text-brand-muted">
                {r.minutes ?? '—'}
              </td>
              <td className="px-2 text-right tabular-nums text-white">{r.goals}</td>
              <td className="px-2 text-right tabular-nums text-white">{r.assists}</td>
              <td className="px-2 text-right tabular-nums text-brand-muted whitespace-nowrap">
                {r.yellow || r.red ? `${r.yellow}/${r.red}` : '—'}
              </td>
              <td className="px-2 pr-2 py-2 text-right rounded-r-xl">
                <span className="ds-display text-white font-bold tabular-nums">{r.points}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
