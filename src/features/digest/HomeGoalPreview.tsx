import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { watchUrl } from './digestFormat';
import { fetchTopClip, type TopClip } from './topClip';

/**
 * Лучший гол выходных — прямо на главном экране.
 *
 * ССЫЛКИ БЫЛО НЕ НАЙТИ. Ролики жили за строкой «Дайджест дня», и слово
 * «дайджест» обещает новости, а не видео: экран открывали, голов не находили и
 * спрашивали, где они. Ответ «одним тапом внутри» — это ответ про устройство
 * приложения, а не про то, что видит человек. Поэтому лучший ролик показан
 * здесь, с картинкой, а строка списка ниже переименована так, чтобы называть
 * голы своим словом.
 *
 * КАРТОЧКА ГОРИЗОНТАЛЬНАЯ, а не в ширину экрана. Превью 16:9 во всю ширину —
 * это почти 200 пикселей, и шесть игр под ним уехали бы за сгиб. Здесь она
 * занимает по высоте одну строку списка с небольшим запасом.
 *
 * МЕСТО ПОД НЕЁ ЗАНЯТО СРАЗУ. Ответ приходит по сети, и появление карточки
 * после первого кадра сдвинуло бы весь список вниз — ровно в тот момент, когда
 * палец уже летит к строке. Скелет держит ту же высоту.
 */
export function HomeGoalPreview() {
  const { t, i18n } = useTranslation();
  // undefined — ещё грузим, null — показывать нечего.
  const [clip, setClip] = useState<TopClip | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const top = await fetchTopClip();
      if (!cancelled) setClip(top);
    })();
    return () => { cancelled = true; };
  }, []);

  const viewFmt = useMemo(
    () => new Intl.NumberFormat(i18n.language, { notation: 'compact' }),
    [i18n.language],
  );

  if (clip === null) return null;

  const CAPTION: Record<TopClip['kind'], string> = {
    goal: 'home.top_goal',
    moment: 'home.top_moment',
    fresh: 'home.fresh_clip',
  };

  if (clip === undefined) {
    return (
      <div className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl p-2 flex items-center gap-3">
        <span className="w-[112px] h-[63px] shrink-0 rounded-xl bg-brand-border/60 animate-pulse" />
        <span className="flex-1 space-y-1.5">
          <span className="block h-3 rounded bg-brand-border/60 animate-pulse" />
          <span className="block h-3 w-2/3 rounded bg-brand-border/60 animate-pulse" />
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { hapticImpact('light'); openLink(watchUrl(clip)); }}
      className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl p-2 flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
    >
      <span className="relative w-[112px] h-[63px] shrink-0 rounded-xl overflow-hidden bg-brand-border/60">
        {clip.thumb_url && (
          <img src={clip.thumb_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-8 h-8 rounded-full bg-black/55 flex items-center justify-center">
            <IconPlayerPlayFilled size={14} className="text-white translate-x-[1px]" />
          </span>
        </span>
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-brand-accent text-[10px] uppercase tracking-wider">
          {t(CAPTION[clip.kind])}
        </span>
        {/* Две строки максимум: заголовки роликов бывают длинными, а карточка
            держит высоту ради списка под ней. */}
        <span className="block text-white text-[13px] leading-tight line-clamp-2 mt-0.5">
          {clip.title}
        </span>
        <span className="block text-brand-muted text-[10px] mt-0.5 truncate">
          {clip.channel}
          {clip.views !== null && ` · ${t('digest.views', { count: clip.views, n: viewFmt.format(clip.views) })}`}
        </span>
      </span>
    </button>
  );
}
