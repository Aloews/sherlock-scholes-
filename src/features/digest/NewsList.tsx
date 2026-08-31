import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFlame, IconExternalLink } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { fetchNews, type NewsItem } from './digestApi';
import { groupStories } from './groupStories';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { feedLanguage } from './digestFormat';
import { timeFormat } from '@/shared/lib/dateFormat';

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
 * ⚠️ ОДИН СЮЖЕТ — ОДНА КАРТОЧКА. Прежде лента печатала громкую новость
 * столько раз, сколько изданий о ней вышло: трансфер Делапа занимал пять
 * строк подряд на четырёх языках. Владелец назвал ленту «сухой», и дело было
 * не в оформлении, а в повторах — читать одно и то же пять раз нечего.
 * Склейка — `groupStories`, порог и токены серверные (см. storyTokens.ts).
 *
 * ⚠️ И КАРТИНКИ. `image_url` лежал в ответе с самого начала и не рисовался
 * НИ РАЗУ: лента была чистым текстом при 76% заметок с картинкой. Но у
 * русских заметок картинка лишь у 46%, поэтому вёрстка обязана переживать её
 * отсутствие как норму, а не как дыру: без картинки текст просто занимает всю
 * ширину.
 *
 * ССЫЛКИ ОТКРЫВАЮТСЯ СНАРУЖИ, через openLink: мини-приложение живёт в WebView,
 * и переход по внешней ссылке внутри него — это уход из игры без пути назад.
 */
export function NewsList({ limit = 60 }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const [news, setNews] = useState<LoadState<NewsItem[]>>(LOADING);
  const lang = feedLanguage(i18n.language);

  /**
   * Склейка считается ОДИН РАЗ НА ОТВЕТ, а не на кадр: это O(n²) по числу
   * заметок, и на шестидесяти это доли миллисекунды, но в теле рендера они
   * тратились бы на каждую перерисовку списка.
   */
  const stories = useMemo(
    () => (news.status === 'ok' ? groupStories(news.data, lang) : []),
    [news, lang],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchNews(lang, limit).then((n) => { if (!cancelled) setNews(n); });
    return () => { cancelled = true; };
  }, [lang, limit]);

  const timeFmt = useMemo(() => timeFormat(i18n.language), [i18n.language]);

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

      {news.status === 'ok' && stories.map(({ lead, alsoSources, sourceCount }) => (
        <button
          key={lead.url}
          type="button"
          onClick={() => open(lead.url)}
          className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 text-left hover:border-brand-accent/50 transition-colors"
        >
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm">{lead.title}</p>
              {/* `lead_text`, а не `summary_short`: суть — это пересказ модели,
                  а если его нет, то начало самой статьи. Выбор делает сервер
                  (digest_news), чтобы экраны не разошлись в том, что считать
                  сутью. Отсутствие строки не читается как поломка: заголовка
                  для этого достаточно. */}
              {lead.lead_text && (
                <p className="text-brand-muted text-xs mt-1 leading-snug">{lead.lead_text}</p>
              )}
            </div>

            {/* Картинки нет почти у половины русских заметок, поэтому её
                отсутствие — норма вёрстки, а не дыра: блока просто нет, текст
                занимает всю ширину. `onError` убирает и битую ссылку: иконка
                сломанного изображения выглядит как поломка приложения. */}
            {lead.image_url && (
              <img
                src={lead.image_url}
                alt=""
                loading="lazy"
                className="w-16 h-16 shrink-0 rounded-xl object-cover bg-brand-border"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
          </div>

          <p className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-1.5">
            <span className="truncate">
              {lead.source}
              {/* Остальные издания сюжета — поимённо, пока помещаются. Это и
                  есть «громкость» в развёрнутом виде: видно не только сколько,
                  но и кто. */}
              {alsoSources.length > 0 && ` · ${alsoSources.join(' · ')}`}
            </span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{timeFmt.format(new Date(lead.published_at))}</span>
            {/* Показывается только с двойки: единица — это «больше никто», и
                для языка с одним изданием она стояла бы у каждой строки.
                Ключ во множественном числе: «2 издания» и «5 изданий» —
                разные формы, и русский с арабским этого не прощают. */}
            {sourceCount > 1 && (
              <span className="flex items-center gap-0.5 text-brand-accent shrink-0">
                <IconFlame size={11} stroke={2} />
                {t('digest.loudness', { count: sourceCount, n: sourceCount })}
              </span>
            )}
            <IconExternalLink size={11} stroke={2} className="ml-auto shrink-0" />
          </p>
        </button>
      ))}
    </section>
  );
}
