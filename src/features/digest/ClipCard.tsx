import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { watchUrl } from './digestFormat';
import type { RankedClip } from './digestApi';

/**
 * Карточка ролика с просмотрами.
 *
 * ОДНА НА ДВА РАЗДЕЛА. Блок выходных и блок недели показывают одно и то же
 * одинаково, и вторая копия этой разметки — это место, где они начнут
 * расходиться: пометка «момент» появится в одном и не появится в другом, и
 * заметить это можно будет только сравнив два экрана глазами.
 */
export function ClipCard({ clip }: { clip: RankedClip }) {
  const { t, i18n } = useTranslation();
  const viewFmt = useMemo(
    () => new Intl.NumberFormat(i18n.language, { notation: 'compact' }),
    [i18n.language],
  );

  return (
    <button
      type="button"
      onClick={() => { hapticImpact('light'); openLink(watchUrl(clip)); }}
      className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden text-left hover:border-brand-accent/50 transition-colors"
    >
      {clip.thumb_url && (
        <span className="block relative">
          <img src={clip.thumb_url} alt="" loading="lazy" className="w-full aspect-video object-cover" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center">
              <IconPlayerPlayFilled size={18} className="text-white translate-x-[1px]" />
            </span>
          </span>
        </span>
      )}
      <span className="block p-3">
        <span className="block text-white text-sm">{clip.title}</span>
        <span className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-1.5">
          <span>{clip.channel}</span>
          <span>·</span>
          <span>{t('digest.views', { count: clip.views, n: viewFmt.format(clip.views) })}</span>
          {/* Разбор по заголовку ошибается в обе стороны, поэтому не-голы не
              выброшены, а помечены. Обещать гол и показать сейв — хуже, чем
              сказать «момент». */}
          {!clip.is_goal && (
            <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-brand-bg text-brand-muted">
              {t('digest.moment')}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
