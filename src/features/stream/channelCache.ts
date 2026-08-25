// Кэш разобранного списка каналов — ЧИСТАЯ часть: ни сети, ни Supabase.
//
// ⚠️ РАДИ ЧЕГО. Каталог по `VITE_STREAM_URL` весит 870 910 байт, и релей
// отдаёт его БЕЗ СЖАТИЯ: заголовка `content-encoding` в ответе нет вовсе,
// `Accept-Encoding: gzip` он игнорирует (проверял 25.08.2026). А
// `cache-control: public, max-age=30` — то есть браузер выбрасывает его через
// полминуты и качает заново.
//
// Что это значит на телефоне, если считать по одному только скачиванию:
//
//   3G медленный (~400 кбит/с)   ~17 с
//   3G обычный   (~1.5 Мбит/с)    ~5 с
//   4G слабый    (~4 Мбит/с)      ~2 с
//
// И всё это ради 34 строк, которые из каталога в итоге остаются. Игрок
// открывает «Прямой эфир», видит «Загружаем список каналов…» и решает, что ТВ
// не работает. Он прав: экран, который столько молчит, неотличим от сломанного.
//
// Поэтому разобранный список кладётся в localStorage и при следующем открытии
// показывается СРАЗУ, а сеть идёт следом и молча обновляет. Кэшируем результат
// разбора (34 записи, единицы килобайт), а не сам каталог: хранить в
// localStorage 870 КБ нельзя — это почти весь его лимит в 5 МБ.

import type { Channel } from './playlist';

const KEY = 'ss_tv_channels';

/**
 * Версия формы записи. Меняется вместе с полями `Channel` или правилами отбора:
 * старая запись тогда отбрасывается, а не читается как своя. Без этого правка
 * фильтров показывала бы вчерашний список тем, у кого он уже лежит.
 */
export const CACHE_VERSION = 2;
const VERSION = CACHE_VERSION;

/** Сколько живёт запись. Сутки: каталог правят руками и не каждый день. */
export const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  v: number;
  /** Когда положили. */
  at: number;
  /** Адрес каталога: сменился `VITE_STREAM_URL` — старый список чужой. */
  src: string;
  channels: Channel[];
}

function isChannel(x: unknown): x is Channel {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return typeof c.name === 'string' && typeof c.group === 'string'
    && typeof c.url === 'string' && (c.logo === null || typeof c.logo === 'string');
}

/**
 * Прочитать список, если он свежий и от того же каталога.
 *
 * ⚠️ ЧИТАЕМ НЕДОВЕРЧИВО. В localStorage лежит то, что туда положили — включая
 * запись, оставшуюся от прежней версии приложения, и просто мусор. Разбор в
 * try/catch, каждое поле проверяется: список каналов, пришедший из хранилища,
 * попадает прямо в плеер, и `undefined.url` уронил бы экран целиком.
 *
 * `null` — «годного кэша нет», и это не ошибка: первый заход выглядит так же.
 */
export function readCache(src: string, now = Date.now()): Channel[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<Entry>;
    if (e.v !== VERSION) return null;
    if (e.src !== src) return null;
    if (typeof e.at !== 'number' || now - e.at > TTL_MS) return null;
    if (!Array.isArray(e.channels) || e.channels.length === 0) return null;
    if (!e.channels.every(isChannel)) return null;
    return e.channels;
  } catch {
    // Приватный режим, переполненное хранилище, битый JSON — всё это значит
    // «кэша нет», а не «приложение сломалось».
    return null;
  }
}

/**
 * Положить список.
 *
 * Пустой не пишем: «сегодня каналов нет» — состояние сети, а не факт о
 * каталоге, и запомнить его на сутки значит на сутки показывать пустой экран
 * там, где сеть уже починилась.
 */
export function writeCache(src: string, channels: Channel[], now = Date.now()): void {
  if (channels.length === 0) return;
  try {
    const entry: Entry = { v: VERSION, at: now, src, channels };
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Квота или приватный режим. Кэш — ускорение, а не условие работы:
    // молчаливый отказ здесь правильнее исключения.
  }
}

// ---------------------------------------------------------------------------
// ЗДОРОВЬЕ КАНАЛОВ
//
// ⚠️ ЗАКРЕПЛЯТЬ КАНАЛЫ ВСЛЕПУЮ ОКАЗАЛОСЬ ОШИБКОЙ, и вот её цена. Замер прода
// 25.08.2026, проход по ПОЛНОЙ цепочке HLS до байтов видео:
//
//   Матч! Премьер        master ok -> variant ok -> media 404   МЁРТВ
//   Setanta Sports 1 HD  master ok -> variant 404               МЁРТВ
//   Setanta Sports 2 HD  master ok -> variant 404               МЁРТВ
//   Viasat Sport         -> 2826 КБ видео                       ЖИВ
//   Viasat Sports        -> 1977 КБ видео                       ЖИВ
//
// Все три мёртвых стояли ПЕРВЫМИ, потому что я поставил их в список вручную —
// по названию, ни разу не спросив, играют ли они. Верхний манифест у всех
// отвечает 200, и проверка, которая на нём останавливается, называет их
// живыми. Игрок открывал экран и упирался в три отказа подряд.
//
// Причём «Матч! Премьер» за десять минут до замера отдавал сегмент на 1.3 МБ.
// Он мигает — а значит СТАТИЧЕСКИЙ список правильным не будет никогда, каким
// бы тщательным ни был. Правильный порядок знает только то, что реально
// проигралось на этом устройстве.
//
// Поэтому здесь помнится исход каждого канала, и порядок строится по нему:
// игравшие — вперёд, неизвестные — следом, отказавшие — в конец. Это не
// заменяет `PINNED` (он решает, КАКИЕ каналы показывать), а поправляет его
// там, где он ошибся: КАКОЙ показать первым.

const HEALTH_KEY = 'ss_tv_health';

/** Сколько помнить исход. Сутки: канал чинят и ломают чаще, чем раз в неделю. */
export const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

export type Health = 'played' | 'failed';

interface HealthEntry { v: number; at: number; urls: Record<string, Health> }

function readHealthRaw(now: number): Record<string, Health> {
  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    if (!raw) return {};
    const e = JSON.parse(raw) as Partial<HealthEntry>;
    if (e.v !== VERSION) return {};
    if (typeof e.at !== 'number' || now - e.at > HEALTH_TTL_MS) return {};
    if (!e.urls || typeof e.urls !== 'object') return {};
    const out: Record<string, Health> = {};
    for (const [k, v] of Object.entries(e.urls)) {
      if (v === 'played' || v === 'failed') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Что известно об исходах. Пустой объект — «ничего», и это не ошибка. */
export function readHealth(now = Date.now()): Record<string, Health> {
  return readHealthRaw(now);
}

/**
 * Запомнить исход одного канала.
 *
 * ⚠️ УСПЕХ ПЕРЕБИВАЕТ ОТКАЗ, но не наоборот в пределах одной записи: канал,
 * который сегодня заиграл, важнее вчерашнего отказа. Обратное правило
 * похоронило бы канал навсегда из-за одной сетевой икоты.
 */
export function markHealth(url: string, health: Health, now = Date.now()): void {
  try {
    const urls = readHealthRaw(now);
    urls[url] = health;
    const entry: HealthEntry = { v: VERSION, at: now, urls };
    localStorage.setItem(HEALTH_KEY, JSON.stringify(entry));
  } catch {
    // см. writeCache — кэш это ускорение, а не условие работы
  }
}

/** Забыть запись. Нужна экрану, когда каталог перестал отвечать совсем. */
export function clearCache(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(HEALTH_KEY);
  } catch {
    // см. writeCache
  }
}
