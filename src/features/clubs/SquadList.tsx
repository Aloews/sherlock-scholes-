import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { hapticImpact } from '@/shared/lib/telegram';
import { formatEur } from '@/shared/lib/money';
import { cardDisplayName } from '@/shared/lib/cardName';
import type { SquadPlayer } from './clubSquadView';

/**
 * Список игроков состава — ОДИН на экран матча и на экран команд.
 *
 * ⚠️ СПРАВА СТОИТ СТОИМОСТЬ, А НЕ НАШ УРОВЕНЬ, и это починка жалобы, а не
 * перестановка. Владелец: «пиши стоимость игрока, а не наш рейтинг, у нашего
 * рейтинга все футболисты имеют по 100. Стоимость точнее отражает уровень
 * игрока». Это видно в самих числах: у состава «Брайтона» `player_level`
 * выдаёт 96–99 подряд всем одиннадцати, а стоимости идут от 60 млн до 2 млн.
 * Число, одинаковое у всех, не различает никого — показывать его как меру
 * уровня значит показывать шум.
 *
 * ⚠️ ИМЯ — ЛАТИНИЦЕЙ, И ПРАВИЛО ОДНО НА ВСЮ ИГРУ (`shared/lib/cardName.ts`).
 * Владелец: «если пользователь не на русском языке пользуется приложением, то
 * пиши имена футболистов в составах латиницей». Прежнее его же правило шире —
 * «имена игроков лучше не переводить, а везде писать латиницей», — и оно уже
 * действует во всей колоде; второй, более узкой копии правила здесь нет
 * намеренно: два правила про одно разъезжаются.
 *
 * ⚠️ ИСТОЧНИК НАЗВАН НАД СПИСКОМ. «Состав по заявке клуба» и «состав по нашим
 * карточкам» — разные утверждения: в первом весь клуб, во втором только те,
 * кого мы оцифровали. Молчаливая подмена одного другим и была тем, из-за чего
 * у клуба выходило то тридцать человек, то ноль.
 */
export function SquadList({ rows, title }: { rows: SquadPlayer[]; title?: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <p className="text-brand-muted text-[10px] mt-1">{t('clubs.squad_unknown')}</p>;
  }

  const source = rows[0].source;
  const sourceLabel = source === 'roster' ? t('clubs.squad_source_roster')
    : source === 'soccerwiki' ? t('clubs.squad_source_soccerwiki')
      : t('clubs.squad_source_cards');

  return (
    <div className="mt-2">
      {title && (
        <p className="text-brand-muted text-[9.5px] uppercase tracking-wider mb-1">{title}</p>
      )}
      <p className="text-brand-muted/70 text-[9.5px] mb-1">{sourceLabel}</p>
      <div className="space-y-0.5">
        {rows.map((m, i) => {
          const name = cardDisplayName(
            { name: m.name, name_en: m.name_en, category: 'player' },
            i18n.language,
          );
          const body = (
            <>
              <span className="w-5 shrink-0 text-brand-muted/60 text-[10px] tabular-nums text-right">
                {m.shirt_number ?? ''}
              </span>
              <span className="flex-1 truncate text-[10.5px] text-white">{name}</span>
              {/* ⚠️ НЕТ ОЦЕНКИ — НЕТ ЧИСЛА. Ноль на этом месте читался бы как
                  «не стоит ничего», хотя значит «мы не знаем». */}
              <span className="text-[10.5px] tabular-nums shrink-0 text-brand-accent">
                {m.market_value_eur ? formatEur(m.market_value_eur, i18n.language) : ''}
              </span>
            </>
          );
          const cls = 'w-full flex items-center gap-2 text-left';
          // Ссылка только туда, где есть что показать: у человека из заявки
          // карточки в колоде может не быть вовсе.
          return m.card_id ? (
            <button
              key={`${m.card_id}-${i}`}
              type="button"
              onClick={() => {
                hapticImpact('light');
                navigate(`/collection?card=${m.card_id}`);
              }}
              className={`${cls} active:opacity-70 transition-opacity`}
            >
              {body}
            </button>
          ) : (
            <div key={`${m.name}-${i}`} className={cls}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
