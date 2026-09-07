import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { TIER_COLOR } from '@/shared/types/database';
import { swLine, swSides, swRatingTier } from '@/shared/lib/soccerwikiPosition';
import { longDateWithYearFormat } from '@/shared/lib/dateFormat';
import { fetchSoccerWikiCard, type SoccerWikiCard } from './soccerwikiApi';

/**
 * Вид карточки игрока по данным Soccer Wiki.
 *
 * Владелец: «вид карточки команд и игроков и данные взять с
 * https://en.soccerwiki.org/».
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕ БЫЛО НИГДЕ ЕЩЁ. Рейтинг 1–99 крупно, роль словом
 * («Крайний защитник», а не код `D,DM,M(L)`), рост, вес и рабочая нога. Ни
 * одного из этих полей у проекта до сих пор не было: рост изредка приходил из
 * инфобокса Википедии, ноги и веса не было вовсе.
 *
 * ⚠️ ИСТОЧНИК ПОДПИСАН, И ЭТО НЕ ФОРМАЛЬНОСТЬ. Soccer Wiki — «for the fans,
 * by the fans»: рейтинг ставят читатели. Рядом на том же экране стоят
 * стоимость Transfermarkt, просмотры Википедии и наш уровень игрока; без
 * подписи все они читались бы как одна шкала «оценка игрока», а меряют разное
 * и расходятся именно на интересных случаях.
 *
 * ⚠️ ПУСТОЙ БЛОК НЕ РИСУЕТСЯ ВОВСЕ. Связаны с колодой не все: у половины
 * карточек соответствия в источнике нет, и рамка с прочерками утверждала бы,
 * что человека там нет, — тогда как его просто не сопоставили.
 */
export function SoccerWikiPanel({ cardId }: { cardId: string }) {
  const { t, i18n } = useTranslation();
  const [row, setRow] = useState<LoadState<SoccerWikiCard[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setRow(LOADING);
    void fetchSoccerWikiCard(cardId).then((r) => { if (!cancelled) setRow(r); });
    return () => { cancelled = true; };
  }, [cardId]);

  const sw = row.status === 'ok' ? row.data[0] ?? null : null;
  if (!sw) return null;

  const line = swLine(sw.position);
  const sides = swSides(sw.position);
  const tone = TIER_COLOR[swRatingTier(sw.rating)];

  // Роль словом. Источник пишет её по-английски («Wingback»), и перевод
  // держится ключами: незнакомая роль показывается как есть, а не пропадает.
  const roleKey = sw.position_desc
    ? `sw.role_${sw.position_desc.toLowerCase().replace(/[^a-z]+/g, '_')}`
    : null;
  const role = roleKey
    ? (i18n.exists(roleKey) ? t(roleKey) : sw.position_desc)
    : (line ? t(`sw.line_${line}`) : null);

  // Рост, вес, нога — ТОЛЬКО то, что измерено. Прочерк в ряду читается как
  // «мы знаем, что неизвестно», и это неправда: поле просто не заполнено.
  const facts = [
    sw.height_cm != null && {
      label: t('sw.height'), value: t('sw.cm', { value: sw.height_cm }),
    },
    sw.weight_kg != null && {
      label: t('sw.weight'), value: t('sw.kg', { value: sw.weight_kg }),
    },
    sw.foot && {
      label: t('sw.foot'),
      value: i18n.exists(`sw.foot_${sw.foot.toLowerCase()}`)
        ? t(`sw.foot_${sw.foot.toLowerCase()}`)
        : sw.foot,
    },
    sw.shirt_number != null && {
      label: t('sw.number'), value: `#${sw.shirt_number}`,
    },
  ].filter(Boolean) as { label: string; value: string }[];

  // ⚠️ Intl бросает RangeError на непрочитанной дате и роняет ВЕСЬ экран в
  // белый лист — так уже было в FantasyScreen. Год обязателен: дата рождения
  // без года — это не дата рождения.
  const born = (() => {
    if (!sw.born_on) return null;
    const d = new Date(sw.born_on);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return longDateWithYearFormat(i18n.language).format(d);
    } catch {
      return sw.born_on;
    }
  })();

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
      <div className="flex items-stretch">
        {/* Рейтинг — крупно и в цвете своей ступени: 94 и 68 должны
            отличаться с одного взгляда, не читая числа. */}
        {sw.rating != null && (
          <div
            className="w-[74px] shrink-0 flex flex-col items-center justify-center py-3 px-1"
            style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}
          >
            <span
              className="ds-display text-[28px] font-black leading-none tabular-nums"
              style={{ color: tone }}
            >
              {sw.rating}
            </span>
            <span className="text-[8.5px] uppercase tracking-[0.08em] text-brand-muted mt-1">
              {t('sw.rating')}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1">
          {role && (
            <p className="text-[13px] font-bold text-white truncate">
              {role}
              {sides && (
                <span className="text-brand-muted font-normal ml-1.5 text-[11px]">
                  {sides.split('').map((s) => t(`sw.side_${s.toLowerCase()}`)).join(' · ')}
                </span>
              )}
            </p>
          )}
          {sw.position && (
            <p className="text-[10.5px] text-brand-muted tabular-nums">{sw.position}</p>
          )}
          {born && (
            <p className="text-[11px] text-brand-muted">
              {t('sw.born', { date: born })}
              {sw.age != null && ` · ${t('sw.years', { count: sw.age })}`}
            </p>
          )}
        </div>
      </div>

      {facts.length > 0 && (
        <div className="grid grid-cols-4 gap-px bg-brand-border border-t border-brand-border">
          {facts.map((f) => (
            <div key={f.label} className="bg-brand-surface px-1 py-2 text-center">
              <p className="ds-display text-[13px] font-bold text-white tabular-nums leading-none">
                {f.value}
              </p>
              <p className="text-[8.5px] uppercase tracking-wide text-brand-muted mt-1 truncate">
                {f.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Имя источника — на самом блоке, а не в подвале экрана. */}
      <p className="px-3 py-1.5 text-[9.5px] text-brand-muted border-t border-brand-border">
        {sw.full_name && sw.full_name.length > 2
          ? t('sw.source_named', { name: sw.full_name })
          : t('sw.source')}
      </p>
    </div>
  );
}
