import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFlame, IconExternalLink } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { fetchNews } from './digestApi';
import { groupStories, type Story } from './groupStories';
import { feedLanguage, plainText } from './digestFormat';
import { leadAddsDetail, storyReveal } from './leadNovelty';

/**
 * САМЫЙ ОБСУЖДАЕМЫЙ СЮЖЕТ, РАСКРЫТЫЙ — и только он один.
 *
 * ⚠️ ПОЯВЛЯЕТСЯ ПО НАЖАТИЮ, А НЕ САМ. Владелец: «добавь функцию раскрытия
 * новости, только у самой обсуждаемой новости и только по нажатию на кнопку
 * „краткая суть“». Отсюда и место в дереве: компонент монтируется, когда
 * нажата кнопка, — значит и запрос в ленту уходит тогда же, а не при открытии
 * экрана. Кто сводку не просил, тот и лишнего запроса не платит.
 *
 * ⚠️ «ГРОМЧЕ ВСЕГО» СЧИТАЕТ `groupStories`, А НЕ ЭТОТ ФАЙЛ. Громкость — это
 * число РАЗНЫХ изданий, вышедших с одним сюжетом, и правило уже живёт в ленте
 * заголовков. Второе определение здесь дало бы два ответа на вопрос «какая
 * новость главная» — ровно та ошибка, ради которой в этом проекте одна
 * SQL-функция отбирает колоду для всех экранов сразу.
 *
 * ⚠️ ЧТО ИМЕННО РАСКРЫВАЕТСЯ — НЕ ЗАГОЛОВОК КРУПНЕЕ. Про прошлое раскрытие
 * владелец сказал: «точно такое же как заголовок, убери либо добавляй детали,
 * которые не были описаны в заголовке». Здесь показывается то, чего в ленте
 * нет вовсе: ЧТО НАПИСАЛИ ОСТАЛЬНЫЕ ИЗДАНИЯ. Лента печатает только их
 * названия, а тексты у неё в руках уже есть — отбор в `storyReveal`.
 *
 * Молчит, а не пустует: нет сюжета, одно издание, нечего добавить — блока
 * просто нет. Рядом стоит сводка, и вторая надпись «ничего нет» только шумит.
 */
export function LoudestStory({ limit = 60 }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const lang = feedLanguage(i18n.language);
  const [story, setStory] = useState<Story | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchNews(lang, limit).then((n) => {
      if (cancelled || n.status !== 'ok') return;
      // Лента отсортирована сервером по громкости, склейка порядок сохраняет:
      // первый сюжет и есть самый обсуждаемый.
      setStory(groupStories(n.data, lang)[0] ?? null);
    });
    return () => { cancelled = true; };
  }, [lang, limit]);

  // Отбор — один раз на ответ, а не на кадр: он перебирает тексты сюжета.
  const parts = useMemo(
    () => (story
      ? storyReveal(story.lead.title, story.lead.lead_text,
        story.items.filter((n) => n.url !== story.lead.url))
      : []),
    [story],
  );

  if (!story) return null;
  // Одно издание — не «обсуждаемое». Раскрывать там нечем: вторых текстов о
  // событии не существует, и блок повторил бы строку ленты слово в слово.
  if (story.sourceCount < 2) return null;

  const { lead, sourceCount } = story;
  const leadText = leadAddsDetail(lead.title, lead.lead_text) ? plainText(lead.lead_text) : '';

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2.5">
      <p className="flex items-center gap-1.5 text-brand-muted text-[10px] uppercase tracking-wider">
        <IconFlame size={12} stroke={2} className="text-brand-accent" />
        {t('digest.loudest')}
      </p>

      <button
        type="button"
        onClick={() => { hapticImpact('light'); openLink(lead.url); }}
        className="w-full text-left"
      >
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm leading-snug">{lead.title}</p>
            {/* Та же проверка, что в ленте: у русских лент description в RSS
                повторяет заголовок, и строка без строки лучше строки, которая
                ничего не сообщила. */}
            {leadText && (
              <p className="text-brand-muted text-xs mt-1 leading-snug">{leadText}</p>
            )}
          </div>
          {/* Картинки нет почти у половины русских заметок — это норма вёрстки,
              а не дыра. `onError` убирает и битую ссылку: иконка сломанного
              изображения читается как поломка приложения. */}
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
        <p className="flex items-center gap-1.5 text-brand-muted text-[10.5px] mt-2">
          <span className="truncate">{lead.source}</span>
          <span className="shrink-0">·</span>
          <span className="flex items-center gap-0.5 text-brand-accent shrink-0">
            <IconFlame size={11} stroke={2} />
            {t('digest.loudness', { count: sourceCount, n: sourceCount })}
          </span>
          <IconExternalLink size={11} stroke={1.75} className="ml-auto shrink-0" />
        </p>
      </button>

      {parts.length > 0 && (
        <div className="pt-2.5 border-t border-brand-border space-y-2">
          <p className="text-brand-muted text-[10px] uppercase tracking-wider">
            {t('digest.loudest_more')}
          </p>
          {parts.map((p) => (
            <div key={p.source}>
              <p className="text-brand-accent text-[10.5px]">{p.source}</p>
              <p className="text-brand-muted text-xs leading-snug">{p.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
