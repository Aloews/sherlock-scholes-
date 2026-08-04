// Inviting someone into a room. Everything here is pure string work plus one
// clipboard call, so it is testable without a Telegram client.

const BOT = 'sherlock_scholes_bot';

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

/**
 * The link that opens the Mini App with the room code already filled in.
 * Telegram delivers everything after `startapp=` as initDataUnsafe.start_param,
 * which getStartParam() reads on launch — the two halves only work together.
 */
export function deepLink(code: string): string {
  return `https://t.me/${BOT}?startapp=${encodeURIComponent(code)}`;
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
