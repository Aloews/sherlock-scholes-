import type { CollectionFacet } from '@/features/collection/collectionApi';

/**
 * Кэш списков отбора в localStorage — тот же приём, что в sherlock-tv
 * (`src/features/stream/channelCache.ts`).
 *
 * ⚠️ РАДИ ЧЕГО. Владелец: «коллекции теперь стали очень медленно грузиться».
 * Замер 07.09.2026 на боевом адресе анон-ключом: `collection_facets` отвечал
 * 700–1200 мс и отдавал 74 655 байт, и экран ждал его на КАЖДОМ открытии.
 * После починки самой функции — 400 мс и 38 597 байт, но 400 мс это всё ещё
 * пустой экран на каждом заходе.
 *
 * В sherlock-tv ровно эта же болезнь лечилась ровно так: разобранный список
 * кладётся в localStorage и при следующем открытии показывается СРАЗУ, а сеть
 * идёт следом и молча обновляет.
 *
 * ⚠️ КЭШИРУЕТСЯ РАЗОБРАННЫЙ ОТВЕТ, А НЕ СЫРОЙ. 38 КБ — это уже немало для
 * localStorage (лимит около 5 МБ), но терпимо; складывать туда сырой ответ со
 * всеми полями было бы вдвое дороже без выигрыша.
 *
 * ⚠️ У КЭША ЕСТЬ СРОК. Клубы и лиги меняются медленно, но меняются: карточка
 * заведена — клуб появился. Сутки это компромисс между «список устарел» и
 * «каждое открытие платит 400 мс».
 *
 * ⚠️ ЛЮБОЕ ОБРАЩЕНИЕ К localStorage В TRY. В приватном окне и при
 * запрещённых сайтовых данных сам доступ БРОСАЕТ, а не возвращает null, и
 * непойманное исключение здесь уронило бы экран целиком.
 */
const KEY = 'ss_facets_v1';
const TTL_MS = 24 * 60 * 60 * 1000;

interface Stored {
  at: number;
  category: string;
  facets: CollectionFacet[];
}

export function readFacets(category: string): CollectionFacet[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Stored;
    if (!data || data.category !== category) return null;
    if (!Array.isArray(data.facets) || data.facets.length === 0) return null;
    if (Date.now() - data.at > TTL_MS) return null;
    return data.facets;
  } catch {
    return null;
  }
}

export function writeFacets(category: string, facets: CollectionFacet[]): void {
  // ⚠️ ПУСТОЙ ОТВЕТ НЕ КЭШИРУЕТСЯ. Одна неудачная загрузка иначе закрепила бы
  // пустой список на сутки, и отбор исчез бы с экрана без единой ошибки.
  if (!Array.isArray(facets) || facets.length === 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      at: Date.now(), category, facets,
    } satisfies Stored));
  } catch {
    /* переполнен или запрещён — экран работает и без кэша */
  }
}
