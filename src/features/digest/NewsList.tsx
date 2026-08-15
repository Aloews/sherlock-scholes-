import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFlame, IconExternalLink } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { fetchNews, type NewsItem } from './digestApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { feedLanguage } from './digestFormat';

/**
 * Лента заголовков.
 *
 * ВЫНЕСЕНА ИЗ ДАЙДЖЕСТА НА СВОЙ ЭКРАН. Пока новости и ролики жили на одной
 * странице, каждая мешала другой: за голами приходилось прокручивать
 * заголовки, а за новостями — видео. Это разные вопросы и разные поводы
 * открыть приложение.
 *
 * ПОРЯДОК — ПО ГРОМКОСТИ: сколько РАЗНЫХ изданий вышло с тем же сюжетом. У
 * RSS нет ни просмотров, ни лайков, но громкая новость выдаёт себя тем, что
 * её пишут все сразу. Считается при чтении, потому что сюжет набирает
 * громкость постепенно.
 *
 * ССЫЛКИ ОТКРЫВАЮТСЯ СНАРУЖИ, через openLink: мини-приложение живёт в WebView,
 * и переход по внешней ссылке внутри него — это уход из игры без пути назад.
 */
export function NewsList({ limit = 60 }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const [news, setNews] = useState<LoadState<NewsItem[]>>(LOADING);
  const lang = feedLanguage(i18n.language);

  useEffect(() => {
    let cancelled = false;
    void fetchNews(lang, limit).then((n) => { if (!cancelled) setNews(n); });
    return () => { cancelled = true; };
  }, [lang, limit]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );

  const open = (url: string) => { hapticImpact('light'); openLink(url); };

  return (
    <section className="space-y-2">
      {news.status === 'loading' && (
        <p className="text-brand-muted text-sm py-4">{t('digest.loading')}</p>
      )}

      {/* СЛОМАЛОСЬ — ЭТО НЕ ПУСТО, и теперь это видно. Раньше отказ RPC
          показывался той же надписью «за сутки ничего не пришло»: человек
          читал её как «новостей нет» и уходил, а на деле лента не отвечала.
          Код ошибки на экране — чтобы о поломке можно было СКАЗАТЬ, не
          открывая консоль, которую всё равно никто не открывает. */}
      {news.status === 'error' && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 text-center space-y-1">
          <p className="text-brand-muted text-sm">{t('news.failed')}</p>
          <p className="text-brand-muted/50 text-[10px] font-mono">{news.code}</p>
        </div>
      )}

      {news.status === 'ok' && news.data.length === 0 && (
        <p className="text-brand-muted text-sm py-4">{t('digest.empty_news')}</p>
      )}

      {news.status === 'ok' && news.data.map((item) => (
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
            {/* Показывается только с двойки: единица — это «больше никто», и
                для языка с одним изданием она стояла бы у каждой строки.
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
  );
}
