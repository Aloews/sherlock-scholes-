/**
 * Токены заголовка — ПОРТ СЕРВЕРНОЙ ФУНКЦИИ `digest_tokens`, буква в букву.
 *
 * ЗАЧЕМ ЭТО ЗДЕСЬ. Сервер уже считает `loudness` — сколько РАЗНЫХ изданий
 * вышло с тем же сюжетом, — но не говорит, КАКИЕ именно заметки в один сюжет
 * попали. Поэтому одна новость занимает в ленте пять строк подряд:
 *
 *   6  Chelsea's Liam Delap set for £50M Nottingham Forest move   ESPN
 *   6  «Ноттингем Форест» договорился о трансфере Делапа          Чемпионат
 *   5  Delap heads to Forest for £50m                             The Guardian
 *   5  Forest agree £50m deal for Chelsea striker Delap           BBC Sport
 *   5  Forest agree club-record deal for Chelsea's Delap          Sky Sports
 *
 * Ровно от этого лента и читается сухой: дело не в оформлении, а в том, что
 * один сюжет напечатан пять раз.
 *
 * ⚠️ ПОЧЕМУ СКЛЕЙКА НА КЛИЕНТЕ, А НЕ В SQL. Пробовал в SQL и ЗАМЕРИЛ: текущий
 * `digest_news` выполняется 1330 мс, а версия, которая заодно считает
 * кластеры, — 2759 мс. План показывает почему: пересечение токенов
 * выполняется 176 400 раз, и 175 204 строки join тут же выбрасывает. Платить
 * ещё 1.4 секунды на экране, который и так ждёт полторы, нельзя.
 *
 * На клиенте те же 60 заметок — это 1800 сравнений готовых массивов, то есть
 * доли миллисекунды, и ни одного лишнего запроса.
 *
 * ⚠️ ПОРТ ОБЯЗАН СОВПАДАТЬ С СЕРВЕРОМ. Разойдутся — и склейка на экране
 * перестанет соответствовать числу «изданий», которое считает сервер: рядом
 * встанут «5 изданий» и три карточки. Совпадение закреплено тестом на живых
 * заголовках.
 */

/** Диакритика снимается явно — тем же списком, что в `digest_translit`. */
const ACCENTS_FROM = 'áàâäãåéèêëíìîïóòôöõøúùûüýÿñçšśşžźżčćĝğłđðřňťďůě';
const ACCENTS_TO   = 'aaaaaaeeeeiiiioooooouuuuyyncssszzzccggldd' + 'rntdue';

/** Однобуквенная кириллица. Многобуквенная снимается ДО неё, см. ниже. */
const CYR_FROM = 'абвгдеёзийклмнопрстуфхцыэ';
const CYR_TO   = 'abvgdeeziiklmnoprstufhsye';

function translate(s: string, from: string, to: string): string {
  let out = '';
  for (const ch of s) {
    const i = from.indexOf(ch);
    out += i >= 0 ? to[i] : ch;
  }
  return out;
}

/**
 * Транслитерация слова — порядок шагов важен и повторяет серверный.
 *
 * ⚠️ Многобуквенные кириллические (ж, ч, ш, щ, ю, я) снимаются ДО
 * однобуквенных: иначе посимвольная замена разберёт их поодиночке и склеит
 * не то.
 *
 * `c → s` и `j → i` в конце — не косметика: кириллица не различает написаний
 * Barcelona/Барселона, и без свёртки основы расходятся. Побочно сходятся
 * Манчестер и Manchester, Ювентус и Juventus.
 */
export function translit(word: string): string {
  let w = translate(word.toLowerCase(), ACCENTS_FROM, ACCENTS_TO);
  w = w.replace(/ж/g, 'zh').replace(/ч/g, 'ch').replace(/ш/g, 'sh')
       .replace(/щ/g, 'sch').replace(/ю/g, 'iu').replace(/я/g, 'ia')
       .replace(/ъ/g, '').replace(/ь/g, '');
  w = translate(w, CYR_FROM, CYR_TO);
  return w.replace(/c/g, 's').replace(/j/g, 'i');
}

/**
 * Основы заголовка: слова от четырёх букв, не числа, транслитерированные и
 * обрезанные до пяти знаков. Обрезка и есть то, чем «Ноттингем» встречается с
 * «Nottingham»: notti = notti.
 *
 * Длина проверяется у ИСХОДНОГО слова, а обрезка делается ПОСЛЕ
 * транслитерации — так на сервере, и порядок здесь не переставляем.
 */
export function storyTokens(title: string): Set<string> {
  const words = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 4 || /^[0-9]+$/.test(w)) continue;
    out.add(translit(w).slice(0, 5));
  }
  return out;
}

/** Сколько основ общих. Тот же порог, что у сервера: три и больше — один сюжет. */
export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

export const SAME_STORY_TOKENS = 3;
