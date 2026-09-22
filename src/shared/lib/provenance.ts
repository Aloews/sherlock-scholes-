/**
 * НЕВИДИМАЯ МАРКИРОВКА СОБРАННОГО КОНТЕНТА — прямо в разметке.
 *
 * ⚠️ ЭТО НЕ ДУБЛЬ ЭКРАНА «ИСТОЧНИКИ», А ВТОРАЯ ПОЛОВИНА ОДНОГО ОТВЕТА.
 * Видимая подпись стоит там, где у неё есть место (досье, /sources). Но
 * подпись нужна КАЖДОМУ показанному файлу, а карточка в игре мелькает
 * секундами, эмблема в строке матча — шесть пикселей: видимую строку туда не
 * поставить, не сломав то, ради чего экран существует.
 *
 * ⚠️ И ЭТО НЕ САМОДЕЛЬНАЯ ПОМЕТКА. CC 4.0 (§3.a.2) прямо разрешает указывать
 * авторство «любым разумным для носителя способом», включая машиночитаемые
 * метаданные и ссылку. То есть невидимая маркировка в признанном формате —
 * это исполнение лицензии, а не его имитация; самодельный же ключ в колонке
 * базы, которого нет в выдаче, не значит ничего.
 *
 * Поэтому здесь ровно то, что читается машиной и не видно человеку:
 *
 *   data-origin   ключ источника (`content_source.key`)
 *   data-author   автор файла, как его называет источник
 *   data-license  лицензия ЭТОГО файла (у Викисклада она своя у каждого)
 *   data-credit   страница файла у источника
 *
 * ⚠️ ИСТОЧНИК ВЫВОДИТСЯ ИЗ ССЫЛКИ, А НЕ ПРИЕЗЖАЕТ КОЛОНКОЙ. Иначе каждый
 * список карточек тащил бы лишнее поле на строку, а половина экранов просто
 * забыла бы его запросить — и «маркировка ко всему» превратилась бы в
 * маркировку к тому, что вспомнили.
 *
 * ⚠️ И ИМЕННО ПОЭТОМУ ПРАВИЛО ЗДЕСЬ — КОПИЯ SQL'НОГО, А КОПИИ РАСХОДЯТСЯ.
 * Оригинал — `content_source_key` в `supabase/migrations/content_rights.sql`.
 * Сверяет их `test/provenance_parity.test.ts`: разъехались — красное.
 */

/** Хост файла → ключ источника. Копия строк `kind = 'host'` из моста. */
export const HOST_SOURCE: Readonly<Record<string, string>> = {
  'commons.wikimedia.org': 'wikimedia_commons',
  'upload.wikimedia.org': 'wikimedia_commons',
  'thumb.wikimedia.org': 'wikimedia_commons',
  'img.a.transfermarkt.technology': 'transfermarkt',
  'a.espncdn.com': 'espn',
  'cdn.soccerwiki.org': 'soccerwiki',
  'r2.thesportsdb.com': 'thesportsdb',
  'www.thesportsdb.com': 'thesportsdb',
};

/**
 * Ключ источника по ссылке. `null` — хост незнакомый.
 *
 * ⚠️ НЕЗНАКОМОЕ ОСТАЁТСЯ NULL, А НЕ СТАНОВИТСЯ «ПРОЧИМ». Метка-заглушка
 * спрятала бы чужое под своим — ровно то, от чего вся эта работа.
 *
 * ⚠️ upload.wikimedia.org РАЗДАЁТ ДВА РАЗНЫХ МИРА ПО ОДНОМУ ХОСТУ:
 * `/wikipedia/commons/` — Викисклад со свободными лицензиями, а
 * `/wikipedia/<язык>/` — локальная загрузка раздела, куда кладут в том числе
 * несвободное. Назвать второе Викискладом значит приписать файлу лицензию,
 * которой у него нет.
 */
export function sourceKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([^/]+)(\/[^?#]*)?/.exec(url);
  if (!m) return null;
  const [, host, path = ''] = m;
  if (host === 'upload.wikimedia.org'
      && path.startsWith('/wikipedia/')
      && !path.startsWith('/wikipedia/commons/')) {
    return 'wikipedia_local';
  }
  return HOST_SOURCE[host] ?? null;
}

export interface Provenance {
  /** Ключ `content_source`. Если не задан — выводится из `url`. */
  source?: string | null;
  /** Ссылка на сам файл: из неё берётся источник, когда он не передан. */
  url?: string | null;
  author?: string | null;
  license?: string | null;
  creditUrl?: string | null;
}

/**
 * Атрибуты для элемента, показывающего собранный контент.
 *
 * ⚠️ ТОЛЬКО `data-*`, И ЭТО НЕ ЛЕНЬ. Разметка карточек и строк матчей
 * рассчитана по пикселям; обёртка ради микроданных сдвинула бы вёрстку на
 * каждом экране сразу. `data-*` не меняет НИ ОДНОГО пикселя и читается так
 * же. Полные микроданные (`<meta itemprop>`) ставятся там, где обёртка уже
 * есть, — в досье, рядом с видимой подписью.
 *
 * Пустые поля не выписываются: атрибут со значением «null» хуже отсутствия —
 * он утверждает, что мы спрашивали и получили пустоту.
 */
export function provenanceAttrs(p: Provenance): Record<string, string> {
  const source = p.source ?? sourceKeyFromUrl(p.url);
  const out: Record<string, string> = {};
  if (source) out['data-origin'] = source;
  if (p.author) out['data-author'] = p.author;
  if (p.license) out['data-license'] = p.license;
  if (p.creditUrl) out['data-credit'] = p.creditUrl;
  return out;
}
