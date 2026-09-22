import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMediaCredits, fetchContentSources, type MediaCredit, type ContentSource }
  from './rightsApi';

/**
 * Подпись под снимком: автор, лицензия, откуда.
 *
 * ⚠️ ЭТО ВЫПОЛНЕНИЕ ЛИЦЕНЗИИ, А НЕ УКРАШЕНИЕ. Фотографии с Викисклада (7072
 * файла, замер 22.09.2026) лежат под CC BY / CC BY-SA: показывать их можно и
 * коммерчески, ровно пока названы автор и лицензия. До этой строки не было
 * названо ни одного.
 *
 * ⚠️ «АВТОРА НЕТ» И «ПОДПИСИ НЕТ» — РАЗНЫЕ СЛУЧАИ, И ВЫГЛЯДЯТ ОНИ РАЗНО.
 * У файла в общественном достоянии автор не указан самим источником, и это
 * законный ответ: подпись тогда — лицензия и источник. А вот если подписи
 * нет вовсе (сборщик до файла ещё не дошёл), показывается хотя бы источник:
 * молчать здесь значит выдавать чужой снимок за ничей.
 *
 * ⚠️ ИМЕНА ИСТОЧНИКОВ НЕ ПЕРЕВОДЯТСЯ. «Wikimedia Commons» подписью и
 * остаётся на всех девяти языках — подпись обязана совпадать с тем, чего
 * требует лицензия, а не с языком интерфейса.
 */

// Реестр источников один на приложение и не меняется в течение сессии:
// держим одно обещание на всех, иначе каждое открытое досье шлёт свой запрос.
let sourcesOnce: Promise<ContentSource[]> | null = null;

function sources(): Promise<ContentSource[]> {
  if (!sourcesOnce) {
    sourcesOnce = fetchContentSources()
      .then((s) => (s.status === 'ok' ? s.data : []))
      // Неудача не кэшируется: следующее досье попробует снова.
      .catch(() => { sourcesOnce = null; return []; });
  }
  return sourcesOnce;
}

interface PhotoCreditProps {
  url: string | null | undefined;
  /** `cards.photo_source` — запасная подпись, когда подписи к файлу ещё нет. */
  sourceKey?: string | null;
  /**
   * Каким элементом рисовать подпись.
   *
   * ⚠️ `figcaption` ТОЛЬКО ВНУТРИ `figure`, и это не придирка к разметке:
   * именно эта пара говорит разбору, к КАКОМУ изображению относится подпись.
   * У нас на экране досье их два — снимок и его размытая копия подложкой.
   */
  as?: 'p' | 'figcaption';
  className?: string;
}

export function PhotoCredit({ url, sourceKey, as = 'p', className }: PhotoCreditProps) {
  const { t } = useTranslation();
  const [credit, setCredit] = useState<MediaCredit | null>(null);
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCredit(null);
    setSourceTitle(null);
    if (!url) return;

    void (async () => {
      const [got, list] = await Promise.all([fetchMediaCredits([url]), sources()]);
      if (!alive) return;
      const row = got.status === 'ok' ? got.data.find((r) => r.url === url) ?? null : null;
      setCredit(row);
      setSourceTitle(list.find((s) => s.key === sourceKey)?.title ?? null);
    })();

    return () => { alive = false; };
  }, [url, sourceKey]);

  if (!url) return null;

  const author = credit?.author?.trim() || null;
  const license = credit?.license?.trim() || null;
  if (!author && !license && !sourceTitle) return null;

  const parts: string[] = [];
  if (author) parts.push(author);
  if (license) parts.push(license);
  if (sourceTitle) parts.push(sourceTitle);

  const line = t('rights.photo', { credit: parts.join(' · ') });
  const cls = className
    ?? 'text-[10px] leading-snug text-brand-muted/80 mt-1.5 block';
  const Caption = as;

  return (
    <>
      {/*
        ⚠️ НЕВИДИМАЯ ПОЛОВИНА ПОДПИСИ. `<meta itemprop>` внутри `<body>` —
        стандартный способ нести метаданные, которых не видно человеку, и
        CC 4.0 (§3.a.2) прямо принимает такую форму указания авторства:
        «любым разумным для носителя способом, включая ссылку или
        машиночитаемые метаданные».

        Видимая строка ниже остаётся и никуда не денется: там, где место под
        неё есть, прятать имя автора незачем. Но метка нужна и там, где
        строку поставить некуда, — поэтому обе половины одного ответа живут
        в одном компоненте, и забыть одну из них нельзя.
      */}
      {author && <meta itemProp="creator" content={author} />}
      {license && <meta itemProp="license" content={credit?.license_url || license} />}
      {sourceTitle && <meta itemProp="sourceOrganization" content={sourceTitle} />}
      {credit?.credit_url && <link itemProp="url" href={credit.credit_url} />}

      <Caption className={cls}>
        {credit?.credit_url ? (
          <a
            href={credit.credit_url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-brand-accent transition-colors"
          >
            {line}
          </a>
        ) : line}
      </Caption>
    </>
  );
}
