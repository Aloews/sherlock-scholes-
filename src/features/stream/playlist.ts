// Разбор M3U-плейлиста — ЧИСТАЯ часть: ни сети, ни Supabase, ни окружения.
//
// ⚠️ РАДИ ЧЕГО ЭТОТ ФАЙЛ ВООБЩЕ ПОЯВИЛСЯ. Экран `/stream` не мог работать
// никогда, и дело было не в плеере. `VITE_STREAM_URL` отдаёт вот это:
//
//   #EXTM3U url-tvg="http://iptvx.one/epg/epg.xml.gz"
//   #EXTINF:-1 group-title="SPORT 🏆",Setanta Sports 1 HD
//   https://stream8.cinerama.uz/1263/tracks-v1a1/mono.m3u8
//   … ещё 4080 таких же строк
//
// Это КАТАЛОГ КАНАЛОВ, а не HLS-манифест. Ни одного `#EXT-X-STREAM-INF`, ни
// одного `#EXT-X-TARGETDURATION`, ни одного `#EXT-X-VERSION` — я проверял
// боевой ответ, их там ровно ноль. А `StreamScreen` отдавал этот адрес прямо
// в `useHlsPlayer`, то есть в `hls.loadSource()`. Играть там нечего: hls.js
// ждёт манифест, а получает список ссылок на другие манифесты. Отсюда и
// «трансляции не работают» — плеер честно показывал `stream.error` на
// единственное, что ему давали.
//
// Поэтому каталог надо СНАЧАЛА РАЗОБРАТЬ, показать игроку каналы, и только
// выбранный канал отдавать в плеер. Разбор живёт здесь, без единого импорта
// из приложения, — тем же приёмом, что `features/fantasy/tactics.ts` и
// `features/chess/rules.ts`: тест на него не должен падать на клиенте базы,
// которого ему не нужно (см. шапку tactics.ts, там эта история целиком).

export interface Channel {
  name: string;
  group: string;
  /** `tvg-logo` из плейлиста. В боевом списке его нет ни у одного канала. */
  logo: string | null;
  url: string;
}

/**
 * Разобрать текст плейлиста.
 *
 * Формат строки: `#EXTINF:<секунды> ключ="значение" …,<Название>`, а следом
 * — строка с адресом. У живого канала секунды всегда `-1`.
 *
 * ⚠️ АДРЕС ИЩЕТСЯ НЕ «СЛЕДУЮЩЕЙ СТРОКОЙ», А СЛЕДУЮЩЕЙ НЕПУСТОЙ. В боевом
 * файле между записью и её адресом попадаются пустые строки и `#EXTGRP`,
 * и наивное `lines[i + 1]` теряло бы такие каналы молча — что хуже всего:
 * список просто короче, и никто не замечает.
 */
export function parseM3u(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const out: Channel[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;

    const comma = line.indexOf(',');
    // Без запятой у записи нет названия — показывать в списке нечего.
    if (comma === -1) continue;
    const name = line.slice(comma + 1).trim();
    if (!name) continue;

    const attrs = line.slice(0, comma);
    const group = matchAttr(attrs, 'group-title') ?? '';
    const logo = matchAttr(attrs, 'tvg-logo');

    let url = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (!candidate) continue;
      // Ещё один `#EXTINF` — у этой записи адреса не было вовсе; отдаём ей
      // разбираться заново со следующей итерации, а текущую бросаем.
      if (candidate.startsWith('#EXTINF')) break;
      if (candidate.startsWith('#')) continue;
      url = candidate;
      i = j;
      break;
    }
    if (!url) continue;

    out.push({ name, group, logo, url });
  }

  return out;
}

function matchAttr(attrs: string, key: string): string | null {
  const m = new RegExp(`${key}="([^"]*)"`).exec(attrs);
  const value = m?.[1]?.trim();
  return value ? value : null;
}

/**
 * Играбелен ли канал ВНУТРИ Mini App.
 *
 * ⚠️ ТОЛЬКО `https:`, И ЭТО НЕ ПРИДИРКА. Mini App открывается по https, а
 * браузер режет смешанное содержимое: `http://`-поток в https-странице не
 * загрузится ни через hls.js, ни через `video.src`, и никакая правка плеера
 * этого не изменит. В боевом плейлисте таких 96 из 127 спортивных — то есть
 * список «всех каналов» был бы на три четверти из заведомо мёртвых строк.
 * Лучше показать 31 работающий канал, чем 127, из которых играет четверть.
 */
export function isPlayable(channel: Channel): boolean {
  return channel.url.startsWith('https://');
}

/**
 * Спортивный ли канал.
 *
 * По названию группы, а не по точному совпадению с `SPORT 🏆`: группы в этом
 * плейлисте переименовывают и правят руками (там же соседствуют `TEST-1` и
 * `Tест-24-08`), и жёсткая строка однажды тихо оставит экран пустым.
 */
export function isSport(channel: Channel): boolean {
  return /sport|спорт|футбол|futbol/i.test(channel.group);
}

/**
 * Каналы, которые игрок назвал сам. Порядок ВНУТРИ списка значим — он станет
 * порядком в начале экрана.
 *
 * Совпадение по вхождению в название без учёта регистра: стабильного
 * идентификатора у канала в этом плейлисте нет вовсе. `tvg-id` проставлен у 166
 * записей из 4082 и ни одной спортивной, а числа в адресах принадлежат
 * конкретному ретранслятору и меняются вместе с ним.
 *
 * ⚠️ ЗАКРЕПЛЁННЫЙ КАНАЛ ПРОХОДИТ МИМО ФИЛЬТРА ПО ГРУППЕ. «Матч! Премьер» лежит
 * в группе `Оргтехсервис 🎯VPN`, «Беларусь 5» и «Setanta Sports UA» — в
 * `TEST-1`: группы здесь правят руками, и требовать от названного канала ещё и
 * правильной группы значит молча его потерять.
 *
 * ⚠️ НО ФИЛЬТР ПО `https` ОН НЕ ПРОХОДИТ, И ЭТО НЕ ОБСУЖДАЕТСЯ — см. isPlayable.
 * Замер 25.08.2026 по боевому плейлисту: из названных играет РОВНО ОДИН —
 * «Матч! Премьер» (200, `access-control-allow-origin: *`). «Беларусь 5»,
 * «Матч Премьер», «Матч! Футбол 1–3», «sport Футбол 1–3 (HD)», «Setanta Sports
 * UA» отдаются по `http://` и в https-странице не загрузятся ничем. Они
 * оставлены здесь НАРОЧНО: список — это «показать, когда сможем», и в тот день,
 * когда ретранслятор отдаст их по https, они появятся сами, без правки кода.
 */
export const PINNED: readonly string[] = [
  'матч! премьер',   // ЕДИНСТВЕННЫЙ из названных, который сейчас играет
  'матч премьер',
  'беларусь 5',
  'матч! футбол',
  'футбол 1',
  'футбол 2',
  'футбол 3',
  'setanta sports ua',
  'setanta',         // Setanta Sports 1/2 HD — играют
  'viasat sport',
  'eurosport',
  'real madrid',
  'barca',
  'arena sport',     // сербские: АПЛ и Серия А
  'diema sport',
  'nova sport',
];

/** Назван ли канал в PINNED. */
export function isPinned(channel: Channel): boolean {
  const name = channel.name.toLowerCase();
  return PINNED.some((needle) => name.includes(needle));
}

/**
 * Место канала в PINNED, или `PINNED.length` для всех прочих.
 * Живёт рядом со списком, чтобы порядок и отбор читались по одному источнику.
 */
export function pinRank(channel: Channel): number {
  const name = channel.name.toLowerCase();
  const i = PINNED.findIndex((needle) => name.includes(needle));
  return i === -1 ? PINNED.length : i;
}

/**
 * Что показать на экране: спорт, играбельное, без повторов.
 *
 * ⚠️ ПОЧЕМУ ТОЛЬКО СПОРТ, А НЕ ВЕСЬ КАТАЛОГ. Приложение про футбол, а в
 * каталоге 4081 запись, из которых больше 1400 — фильмы, и есть группа
 * `♥18+` на 126 записей. Вываливать это в игру нельзя ни по смыслу, ни по
 * рискам, которые `docs/ADR/0004` и так называет нерешёнными. Спортивная
 * группа — единственная, которой здесь место.
 *
 * Повторы убираются по адресу: один и тот же канал лежит в плейлисте по два
 * и три раза («Матч ТВ» встречается трижды), и в списке это выглядит багом.
 */
export function sportChannels(text: string): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const channel of parseM3u(text)) {
    // Спортивная группа ИЛИ названный канал: см. шапку PINNED — группы в этом
    // плейлисте правят руками, и «Матч! Премьер» лежит не в спортивной.
    if (!(isSport(channel) || isPinned(channel)) || !isPlayable(channel)) continue;
    if (seen.has(channel.url)) continue;
    seen.add(channel.url);
    out.push(channel);
  }
  return out;
}
