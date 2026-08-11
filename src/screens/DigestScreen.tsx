import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconFlame, IconPlayerPlayFilled, IconExternalLink } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { fetchNews, fetchGoals, type NewsItem, type GoalClip } from '@/features/digest/digestApi';
import { watchUrl, feedLanguage } from '@/features/digest/digestFormat';

/**
 * Дайджест дня: что писали и что показывали за последние сутки.
 *
 * ДВА РАЗНЫХ ПОРЯДКА НА ОДНОМ ЭКРАНЕ, и это не небрежность.
 *
 *   Заголовки идут ПО ГРОМКОСТИ — сколько разных изданий вышло с тем же
 *   сюжетом. Просмотров RSS не отдаёт, так что популярность взять неоткуда, но
 *   громкая новость выдаёт себя тем, что её пишут все сразу.
 *
 *   Ролики идут ПО ВРЕМЕНИ, и никакой «лучшести» здесь нет. Atom-фид YouTube
 *   не отдаёт ни просмотров, ни лайков, а заводить ключ и квоту Data API ради
 *   порядка в списке из десяти строк — плохой размен. Что есть на самом деле:
 *   это то, что официальные каналы лиг опубликовали за сутки, а публикуют они
 *   именно голы и моменты. Так и подписано — заголовок секции не обещает
 *   рейтинга, которого нет.
 *
 * ССЫЛКИ ОТКРЫВАЮТСЯ СНАРУЖИ, через openLink. Мини-приложение живёт в WebView,
 * и переход по внешней ссылке внутри него — это уход из игры без пути назад.
 */
export function DigestScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [goals, setGoals] = useState<GoalClip[] | null>(null);

  const lang = feedLanguage(i18n.language);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [n, g] = await Promise.all([fetchNews(lang), fetchGoals()]);
      if (cancelled) return;
      setNews(n);
      setGoals(g);
    })();
    return () => { cancelled = true; };
  }, [lang]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );

  const open = (url: string) => { hapticImpact('light'); openLink(url); };

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('digest.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        {/* ─── Заголовки ─── */}
        <section className="space-y-2">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
            {t('digest.headlines')}
          </p>

          {news === null && <p className="text-brand-muted text-sm py-4">{t('digest.loading')}</p>}
          {news !== null && news.length === 0 && (
            <p className="text-brand-muted text-sm py-4">{t('digest.empty_news')}</p>
          )}

          {news?.map((item) => (
            <button
              key={item.url}
              type="button"
              onClick={() => open(item.url)}
              className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 text-left hover:border-brand-accent/50 transition-colors"
            >
              <p className="text-white text-sm">{item.title}</p>
              <p className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-1.5">
                <span>{item.source}</span>
                <span>·</span>
                <span>{timeFmt.format(new Date(item.published_at))}</span>
                {/* Показывается только с двойки: единица — это «больше никто»,
                    и для языка с одним изданием она стояла бы у каждой строки.
                    Ключ во множественном числе: «2 издания» и «5 изданий» —
                    разные формы, и русский с арабским этого не прощают. */}
                {item.loudness > 1 && (
                  <span className="flex items-center gap-0.5 text-brand-accent">
                    <IconFlame size={11} stroke={2} />
                    {t('digest.loudness', { count: item.loudness, n: item.loudness })}
                  </span>
                )}
                <IconExternalLink size={11} stroke={2} className="ml-auto shrink-0" />
              </p>
            </button>
          ))}
        </section>

        {/* ─── Видео ─── */}
        <section className="space-y-2">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
            {t('digest.goals')}
          </p>
          {/* Обещание ровно того, что есть: подборка каналов лиг за сутки, а
              не рейтинг. */}
          <p className="text-brand-muted text-[10.5px]">{t('digest.goals_note')}</p>

          {goals === null && <p className="text-brand-muted text-sm py-4">{t('digest.loading')}</p>}
          {goals !== null && goals.length === 0 && (
            <p className="text-brand-muted text-sm py-4">{t('digest.empty_goals')}</p>
          )}

          {goals?.map((clip) => (
            <button
              key={clip.video_id}
              type="button"
              onClick={() => open(watchUrl(clip))}
              className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden text-left hover:border-brand-accent/50 transition-colors"
            >
              {clip.thumb_url && (
                <span className="block relative">
                  <img
                    src={clip.thumb_url}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-video object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center">
                      <IconPlayerPlayFilled size={18} className="text-white translate-x-[1px]" />
                    </span>
                  </span>
                </span>
              )}
              <span className="block p-3">
                <span className="block text-white text-sm">{clip.title}</span>
                <span className="block text-brand-muted text-[10.5px] mt-1.5">
                  {clip.channel} · {timeFmt.format(new Date(clip.published_at))}
                </span>
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
