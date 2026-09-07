import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconTrendingUp } from '@tabler/icons-react';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { Chip } from '@/shared/ui/Chip';
import { formatMetric } from '@/shared/lib/metricFormat';
import {
  fetchRisingCards, fetchRisingClubs,
  type RisingCard, type RisingClub,
} from './ratingsApi';

/**
 * Кто набирает ход — игроки и клубы, у которых показатель резко пошёл вверх.
 *
 * Владелец: «нужна система замера изменения рейтинга и подсвечивание лучших
 * игроков, у которых основные показателей резко подрастают (набирающих
 * популярность и ход игроков) и команд».
 *
 * ⚠️ ПОКАЗАТЕЛЬ НАЗЫВАЕТСЯ, И ЧИСЛА «БЫЛО → СТАЛО» СТОЯТ РЯДОМ. «Игрок пошёл
 * в гору» без указания, в чём именно, — бесполезная строка: подорожал, попал в
 * новости и пробежал больше минут это три разных события, и ведут они себя
 * по-разному.
 *
 * ⚠️ ПУСТО ПОКА ЧЕСТНО. История показателей заведена 06.09.2026 и хранит
 * ИЗМЕНЕНИЯ; за первые сутки не изменилось ничего, кроме двух починенных
 * вручную просмотров. Список наполнится, когда истории станет с неделю. Пустая
 * подпись про это говорит прямо — иначе экран читался бы как сломанный.
 */
export function RisingList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [cards, setCards] = useState<LoadState<RisingCard[]>>(LOADING);
  const [clubs, setClubs] = useState<LoadState<RisingClub[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setCards(LOADING);
    setClubs(LOADING);
    void fetchRisingCards(days, 20, i18n.language).then((r) => {
      if (!cancelled) setCards(r);
    });
    void fetchRisingClubs(days, 8, i18n.language).then((r) => {
      if (!cancelled) setClubs(r);
    });
    return () => { cancelled = true; };
  }, [days, i18n.language]);

  const rows = cards.status === 'ok' ? cards.data : [];
  const clubRows = clubs.status === 'ok' ? clubs.data : [];
  const times = (g: number) =>
    `×${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(g)}`;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[7, 30, 90].map((d) => (
          <Chip
            key={d}
            label={t('rising.window', { count: d })}
            selected={days === d}
            onClick={() => { hapticImpact('light'); setDays(d); }}
          />
        ))}
      </div>

      <p className="text-brand-muted/70 text-[11px]">{t('rising.how')}</p>

      {cards.status === 'loading' && (
        <p className="text-brand-muted text-sm text-center py-8">{t('ratings.loading')}</p>
      )}

      {cards.status === 'ok' && rows.length === 0 && clubRows.length === 0 && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6
                        text-center space-y-2">
          <IconTrendingUp size={28} stroke={1.5} className="mx-auto text-brand-muted" />
          {/* ⚠️ ПУСТОТА ЗДЕСЬ УТВЕРЖДАЕТ. «Никто не вырос» и «истории ещё нет»
              выглядят одинаково, а значат разное — подпись называет второе. */}
          <p className="text-brand-muted text-sm">{t('rising.empty')}</p>
        </div>
      )}

      {rows.map((r) => (
        <button
          key={r.card_id}
          type="button"
          onClick={() => { hapticImpact('light'); navigate(`/collection?card=${r.card_id}`); }}
          className="w-full text-left ds-panel bg-brand-surface border border-brand-border
                     rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity"
        >
          {r.photo_url ? (
            <PlayerPhoto src={r.photo_url} className="w-9 h-9 rounded-full shrink-0 bg-brand-bg" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-brand-bg shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm truncate">{r.name}</p>
            <p className="text-brand-muted text-[11px] truncate">
              {[r.club, t(`collection.dyn.${r.metric}`, { defaultValue: r.metric })]
                .filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="ds-display text-brand-accent text-sm font-bold tabular-nums">
              {times(r.growth)}
            </p>
            {/* Числа «было → стало» рядом с ростом: множитель без них
                непроверяем, а непроверяемое число читается как выдуманное. */}
            <p className="text-brand-muted text-[10px] tabular-nums">
              {formatMetric(r.metric, r.was, i18n.language)} →{' '}
              {formatMetric(r.metric, r.now_value, i18n.language)}
            </p>
          </div>
        </button>
      ))}

      {clubRows.length > 0 && (
        <>
          <p className="text-brand-muted text-[11px] uppercase tracking-wide pt-2">
            {t('rising.clubs')}
          </p>
          {clubRows.map((c) => (
            <button
              key={c.club_key}
              type="button"
              onClick={() => { hapticImpact('light'); navigate(`/clubs?club=${c.club_key}`); }}
              className="w-full text-left ds-panel bg-brand-surface border border-brand-border
                         rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity"
            >
              {c.crest_url ? (
                <img src={c.crest_url} alt="" loading="lazy"
                     className="w-7 h-7 shrink-0 object-contain" />
              ) : (
                <span className="w-7 h-7 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{c.club}</p>
                <p className="text-brand-muted text-[11px] truncate">
                  {[c.league, t('rising.by_squad', { count: c.players })]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <p className="ds-display text-brand-accent text-sm font-bold tabular-nums shrink-0">
                {times(c.growth)}
              </p>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
