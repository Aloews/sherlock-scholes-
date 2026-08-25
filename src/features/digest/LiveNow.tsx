import { useTranslation } from 'react-i18next';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { watchUrl } from './digestFormat';
import type { LiveMatch } from './digestApi';

/**
 * «Идёт сейчас» — эфиры, которые лига открыла у себя на канале.
 *
 * РАЗДЕЛА НЕТ, КОГДА НЕЧЕГО ПОКАЗАТЬ, и это решение, а не упрощение. Пустым он
 * будет большую часть суток: права на матчи верхних дивизионов проданы
 * эксклюзивно по странам, бесплатного эфира у лиги там не бывает, и открывают
 * резервные лиги, молодёжь, женский футбол. Заголовок «идёт сейчас» над
 * надписью «ничего не идёт» читался бы как поломка ленты — а лента исправна,
 * футбола просто нет.
 *
 * ⚠️ НАЗВАНИЕ МАТЧА НЕ ПЕРЕВОДИТСЯ. Это заголовок ролика, который написала
 * сама лига, — имя собственное. Переводятся подписи вокруг него.
 */
export function LiveNow({ matches }: { matches: LiveMatch[] }) {
  const { t } = useTranslation();

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
        <button
          key={m.video_id}
          type="button"
          onClick={() => { hapticImpact('light'); openLink(watchUrl(m)); }}
          className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden text-left hover:border-brand-accent/50 transition-colors"
        >
          <span className="block p-3">
            <span className="block text-white text-sm">{m.title}</span>
            <span className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-1.5">
              <span>{m.channel}</span>
              <span>·</span>
              <span>{t('digest.live_official')}</span>
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}
