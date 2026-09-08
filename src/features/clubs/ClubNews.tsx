import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconExternalLink } from '@tabler/icons-react';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { fetchClubNews, type ClubNewsRow } from './clubsApi';
import { openLink, hapticImpact } from '@/shared/lib/telegram';
import { shortDateFormat } from '@/shared/lib/dateFormat';

/**
 * Новости именно об этой команде.
 *
 * Владелец: «добавь возможность добавляться в фан клуб команды и отслеживать
 * новости именно о ней».
 *
 * ⚠️ ЛЕНТА ОБЩАЯ, А ОТБОР — ПО ИМЕНИ КОМАНДЫ, И ЭТО ДЕЛАЕТ SQL. Заголовок
 * обязан содержать ВСЕ основы имени: «Манчестер Сити» и «Манчестер Юнайтед»
 * делят первое слово, и по любой основе болельщик Сити читал бы про Юнайтед.
 * Основы транслитерированы и усечены до пяти букв, поэтому «Реала», «Реал» и
 * «Real» — одно и то же, а издание может быть на любом из девяти языков.
 *
 * ⚠️ ПУСТО — ЗНАЧИТ ПУСТО, И БЛОКА НЕТ. «Сегодня о команде не писали» и «наш
 * конвейер молчит» выглядят на экране одинаково; рамка с подписью «новостей
 * нет» утверждала бы первое, имея, возможно, второе.
 */
export function ClubNews({ clubKey }: { clubKey: string }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<LoadState<ClubNewsRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchClubNews(clubKey, 10).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [clubKey]);

  const list = rows.status === 'ok' ? rows.data : [];
  if (list.length === 0) return null;

  const when = shortDateFormat(i18n.language);

  return (
    <section className="space-y-2">
      <h2 className="ds-display text-white text-base font-bold">{t('club.news')}</h2>
      <div className="space-y-1.5">
        {list.map((n) => {
          let date = '';
          try {
            const d = new Date(n.published_at);
            // Intl бросает RangeError на непрочитанной дате и роняет ВЕСЬ
            // экран в белый лист — так уже было в FantasyScreen.
            if (!Number.isNaN(d.getTime())) date = when.format(d);
          } catch { date = ''; }
          return (
            <button
              key={n.url}
              type="button"
              onClick={() => { hapticImpact('light'); openLink(n.url); }}
              className="w-full ds-panel bg-brand-surface border border-brand-border rounded-xl
                         px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <div className="flex items-start gap-2">
                <span className="flex-1 min-w-0 text-[12.5px] text-white/90">{n.title}</span>
                <IconExternalLink size={13} stroke={1.75} className="text-brand-muted mt-0.5 shrink-0" />
              </div>
              {/* Начало самой статьи из ленты: приходит даром и на языке
                  заметки, поэтому показывается и без пересказа моделью. */}
              {n.lead_text && (
                <p className="text-[11px] text-brand-muted mt-1 line-clamp-2">{n.lead_text}</p>
              )}
              <p className="text-[10px] text-brand-muted/70 mt-1">
                {[n.source, date].filter(Boolean).join(' · ')}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
