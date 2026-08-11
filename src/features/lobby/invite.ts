// Inviting someone into a room. Everything here is pure string work plus one
// clipboard call, so it is testable without a Telegram client.

const BOT = 'sherlock_scholes_bot';

/**
 * Имя Mini App, если оно заведено в BotFather через /newapp.
 *
 * Пусто по умолчанию, и это не заглушка — см. deepLink() ниже: пустая строка
 * означает «именованного приложения нет», и ссылка строится другой формы.
 */
const APP_NAME = (import.meta.env.VITE_TG_APP_NAME as string | undefined) ?? '';

/** Room codes are six chars, uppercase letters and digits — see `create_team_room`. */
const CODE_RE = /^[A-Z0-9]{6}$/;

/**
 * A room code as it arrives from an untrusted source: Telegram's start_param,
 * a paste, a typed field. Returns the normalised code, or null when it is not
 * one. Callers must never navigate on the raw value.
 */
export function normalizeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Room codes are six characters. Exported so the UI never re-guesses it. */
export const CODE_LENGTH = 6;

/**
 * What a room code field should hold after each keystroke or paste.
 *
 * THE FIELD MUST NOT FIGHT THE KEYBOARD. It used to store
 * `e.target.value.toUpperCase()`, which is a different string from what the
 * IME just produced — and on Android a controlled input whose value is
 * rewritten mid-composition can drop the character that caused the rewrite.
 * Normalising to a set the keyboard cannot leave (uppercase A–Z0–9 only, at
 * most six) is not a smaller version of that problem: once the field holds
 * exactly what a valid code can hold, every later keystroke is either accepted
 * verbatim or was never part of a code.
 *
 * It also absorbs the three things people actually paste — a code with spaces
 * or dashes, and the invite link itself.
 */
export function sanitizeCodeInput(raw: string): string {
  return extractCode(raw).slice(0, CODE_LENGTH);
}

/**
 * The code inside whatever was pasted.
 *
 * A shared invite arrives as a whole URL far more often than as six bare
 * characters, and stripping punctuation from `https://t.me/…?startapp=ABC123`
 * yields a wall of letters with the code buried in it. So the link is read as
 * a link first, and only text that is not one gets the blunt treatment.
 */
function extractCode(raw: string): string {
  const text = (raw ?? '').trim();
  // ОБЕ формы, и `startapp` первой: ссылки, разосланные до смены формата,
  // продолжают ходить по чатам, и код в них тот же самый.
  const fromLink = /[?&](?:startapp|start)=([^&\s]+)/i.exec(text);
  const candidate = fromLink ? decodeURIComponent(fromLink[1]) : text;
  return candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A complete code from arbitrary pasted text, or null.
 *
 * Distinct from `sanitizeCodeInput`, which is deliberately permissive because
 * a half-typed code is a normal state. This one answers "is there something to
 * join with", and the caller may act on it without asking.
 */
export function codeFromText(raw: string | null | undefined): string | null {
  return normalizeCode(extractCode(raw ?? ''));
}

/**
 * Ссылка, которая открывает игру сразу в нужной комнате.
 *
 * ТРИ ФОРМЫ, И ВЫБОР МЕЖДУ НИМИ — ЭТО НЕ ВКУС, А НАСТРОЙКА БОТА В BOTFATHER.
 * Telegram различает их жёстко, и ссылка, которой не соответствует настройка,
 * не «работает хуже» — она не открывает приложение вовсе:
 *
 *   t.me/<бот>?startapp=КОД            нужен включённый Main Mini App
 *   t.me/<бот>/<имя>?startapp=КОД      нужно приложение, заведённое /newapp
 *   t.me/<бот>?start=КОД               не нужно ничего
 *
 * ЧТО СЛУЧИЛОСЬ. Приглашения уходили первой формой, а на Android приходило
 * `BOT_INVALID`: клиент доходил до `tg://resolve?domain=…&startapp=…`, и
 * Telegram отказывал, потому что Main Mini App у бота не включён. Страница
 * t.me при этом честно рисует кнопку «Open App» для любой ссылки — она просто
 * генератор редиректа и ничего не проверяет, так что по ней ошибку не видно.
 *
 * ПОЭТОМУ ПО УМОЛЧАНИЮ — ТРЕТЬЯ ФОРМА. Она стоит одного лишнего касания
 * (бот отвечает кнопкой, которая открывает игру), зато не зависит ни от одной
 * настройки и работает у бота, каким он есть сегодня. Обработчик — в
 * supabase/functions/tg-pay/index.ts.
 *
 * Как только в BotFather заведут приложение через /newapp, достаточно
 * выставить VITE_TG_APP_NAME — и ссылка станет односоставной, без правок кода.
 */
export function deepLink(code: string): string {
  const param = encodeURIComponent(code);
  return APP_NAME
    ? `https://t.me/${BOT}/${APP_NAME}?startapp=${param}`
    : `https://t.me/${BOT}?start=${param}`;
}

/**
 * Telegram's share sheet, pre-loaded with the deep link. Same shape EndScreen
 * uses for its post-game share.
 */
export function shareLink(code: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(deepLink(code))}` +
         `&text=${encodeURIComponent(text)}`;
}

/**
 * Copy, honestly. The Clipboard API is missing or refuses in a lot of Telegram
 * WebViews, and the old promise here was neither awaited nor caught, so a
 * failure buzzed the phone and claimed success. The fallback is the pre-2018
 * trick — an off-screen textarea plus execCommand — which still works where
 * the modern API is closed off.
 *
 * Returns whether the text actually landed on the clipboard. Never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  // Off-screen but focusable: display:none or visibility:hidden would make
  // the selection — and therefore the copy — a no-op.
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
