import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { hapticImpact } from '@/shared/lib/telegram';
import { cardDisplayName } from '@/shared/lib/cardName';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import { fetchTopTransfers, type TopTransfer } from './ratingsApi';

/**
 * САМЫЕ ДОРОГИЕ ПЕРЕХОДЫ — внутри рейтинга по стоимости.
 *
 * ⚠️ СТРОКА ЗДЕСЬ — ПЕРЕХОД, А НЕ ЧЕЛОВЕК. У Неймара два дорогих перехода, и
 * он может стоять в списке дважды. Это не дубль: соседний список считает
 * игроков, этот — сделки.
 *
 * ⚠️ ЦЕНА ПЕРЕХОДА И СТОИМОСТЬ ИГРОКА — РАЗНЫЕ ЧИСЛА, и подпись говорит это
 * прямо. 222 млн за Неймара заплатили в 2017-м; сегодня он стоит несоизмеримо
 * меньше, и увидеть два числа рядом без объяснения значит решить, что одно из
 * них неверное.
 *
 * Закрыт по умолчанию: полсотни строк под основным списком стоили бы запроса
 * тому, кто их не откроет.
 */
export function TopTransfers() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LoadState<TopTransfer[]>>(LOADING);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRows(LOADING);
    void fetchTopTransfers(i18n.language, 20).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [open, i18n.language]);

  const list = dataOr(rows, []);
  const money = new Intl.NumberFormat(i18n.language, { notation: 'compact' });
  const year = (d: string) => d.slice(0, 4);

  return (
    <div className="rounded-2xl border border-brand-border overflow-hidden">
      <button
        type="button"
        onClick={() => { hapticImpact('light'); setOpen(!open); }}
        className="w-full px-3 py-2.5 flex items-center justify-between text-left"
      >
        <span className="text-white text-[13px]">{t('transfers_top.title')}</span>
        <span className="text-brand-accent text-[11px]">
          {open ? t('transfers_top.hide') : t('transfers_top.show')}
        </span>
      </button>

      {/* hidden, а не размонтирование: закрыть и открыть заново не должно
          стоить ещё одного запроса. */}
      <div hidden={!open} className="px-2 pb-2 space-y-1.5">
        {rows.status === 'loading' && (
          <p className="text-brand-muted text-[12px] px-1 py-2">{t('ratings.loading')}</p>
        )}
        {rows.status === 'error' && (
          <p className="text-rose-400 text-[12px] px-1 py-2">{t('transfers_top.failed')}</p>
        )}

        {list.map((tr, i) => (
          <button
            key={`${tr.card_id}-${tr.moved_on}-${i}`}
            type="button"
            onClick={() => { hapticImpact('light'); navigate(`/collection?card=${tr.card_id}`); }}
            className="w-full text-left flex items-center gap-2.5 px-1 py-1.5 rounded-xl
                       active:opacity-70 transition-opacity"
          >
            <span className="ds-display text-brand-muted text-[12px] font-bold tabular-nums
                             w-5 text-right shrink-0">{i + 1}</span>
            {tr.photo_url
              ? <PlayerPhoto src={tr.photo_url} className="w-8 h-8 rounded-full shrink-0 bg-brand-bg" />
              : <span className="w-8 h-8 rounded-full bg-brand-bg shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-white text-[13px] truncate">
                {cardDisplayName({ name: tr.name, name_en: tr.name_en, category: 'player' }, i18n.language)}
              </span>
              <span className="block text-brand-muted text-[10.5px] truncate">
                {[tr.from_club, tr.to_club].filter(Boolean).join(' → ')}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block ds-display text-brand-accent text-[13px] font-bold tabular-nums">
                {money.format(tr.fee_eur)} €
              </span>
              <span className="block text-brand-muted text-[10px] tabular-nums">
                {year(tr.moved_on)}
              </span>
            </span>
          </button>
        ))}

        {rows.status === 'ok' && list.length > 0 && (
          <p className="text-brand-muted text-[10.5px] px-1 pt-1 leading-snug">
            {t('transfers_top.note')}
          </p>
        )}
      </div>
    </div>
  );
}
