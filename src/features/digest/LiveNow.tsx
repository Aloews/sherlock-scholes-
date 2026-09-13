import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { timeFormat } from '@/shared/lib/dateFormat';
import { watchUrl } from './digestFormat';
import type { LiveMatch, UpcomingMatch } from './digestApi';

/**
 * Эфиры, которые лига открыла у себя на канале: идущие и назначенные.
 *
 * ⚠️ ДВА РАЗДЕЛА, А НЕ ОДИН, И ЭТО ГЛАВНОЕ ЗДЕСЬ. Раньше он был один, и под
 * надписью «идёт сейчас» стояли анонсы: человек открывал ссылку и читал
 * «трансляция начнётся через 2 дня». Замер 13.09.2026 — восемь строк в
 * разделе, ни одна не шла. Владелец назвал это издевательством, и это точное
 * слово: приложение обещало футбол сейчас и отправляло к таймеру.
 *
 * Разделение честное с обеих сторон. «Идёт сейчас» — только то, у чего есть
 * ФАКТ начала (`actualStartTime` у YouTube), и рядом написано, с какого часа.
 * «Скоро» — то, что назначено на ближайшие часы, и рядом написано, во
 * сколько. Подпись со временем проверяема глазом: читатель видит час и сам
 * решает, ждать ли.
 *
 * РАЗДЕЛА НЕТ, КОГДА НЕЧЕГО ПОКАЗАТЬ, и это решение, а не упрощение. Пустым
 * «идёт сейчас» будет большую часть суток: права на матчи верхних дивизионов
 * проданы эксклюзивно по странам, бесплатного эфира у лиги там не бывает, и
 * открывают резервные лиги, молодёжь, женский футбол. Заголовок над надписью
 * «ничего не идёт» читался бы как поломка ленты — а лента исправна, футбола
 * просто нет.
 *
 * ⚠️ НАЗВАНИЕ МАТЧА НЕ ПЕРЕВОДИТСЯ. Это заголовок ролика, который написала
 * сама лига, — имя собственное. Переводятся подписи вокруг него.
 */

/** Одна карточка эфира. Общая у обоих разделов, чтобы они не разошлись видом. */
function StreamCard({
  videoId, title, channel, note,
}: { videoId: string; title: string; channel: string; note: string }) {
  return (
    <button
      type="button"
      onClick={() => { hapticImpact('light'); openLink(watchUrl({ video_id: videoId })); }}
      className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden text-left hover:border-brand-accent/50 transition-colors"
    >
      <span className="block p-3">
        <span className="block text-white text-sm">{title}</span>
        <span className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-1.5">
          <span>{channel}</span>
          <span>·</span>
          <span>{note}</span>
        </span>
      </span>
    </button>
  );
}

export function LiveNow({ matches }: { matches: LiveMatch[] }) {
  const { t, i18n } = useTranslation();
  const fmt = useMemo(() => timeFormat(i18n.language), [i18n.language]);

  if (matches.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="ds-display text-white text-sm font-black flex items-center gap-2">
        {/* Точка, а не слово «LIVE»: слово пришлось бы переводить на девять
            языков, а половина из них оставила бы английское «LIVE». */}
        <span className="relative flex w-2 h-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-red-500" />
        </span>
        {t('digest.live')}
      </h2>

      {matches.map((m) => (
        <StreamCard
          key={m.video_id}
          videoId={m.video_id}
          title={m.title}
          channel={m.channel}
          // Час начала, а не «официальный канал»: подпись, которую читатель
          // может сверить сам. Именно её отсутствие и позволяло экрану врать.
          note={t('digest.live_since', { time: fmt.format(new Date(m.started_at)) })}
        />
      ))}
    </section>
  );
}

export function LiveSoon({ matches }: { matches: UpcomingMatch[] }) {
  const { t, i18n } = useTranslation();
  const fmt = useMemo(() => timeFormat(i18n.language), [i18n.language]);

  if (matches.length === 0) return null;

  return (
    <section className="space-y-2">
      {/* Без красной точки: она значит «прямо сейчас», и поставить её над
          анонсом было бы тем же враньём, только рисунком вместо слова. */}
      <h2 className="ds-display text-white text-sm font-black">
        {t('digest.live_soon')}
      </h2>

      {matches.map((m) => (
        <StreamCard
          key={m.video_id}
          videoId={m.video_id}
          title={m.title}
          channel={m.channel}
          note={t('digest.live_starts', { time: fmt.format(new Date(m.scheduled_start_at)) })}
        />
      ))}
    </section>
  );
}
