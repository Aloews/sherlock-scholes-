/**
 * Последний ОТВЕТ СЕРВЕРА про подписку — чтобы ворота открывались сразу.
 *
 * ⚠️ ЗАЧЕМ. `ProOnly` держит экран, пока `get_user_status` не ответит, и это
 * целый круговой поход ПЕРЕД тем, как экран вообще начнёт грузить свои
 * данные. Замерено на боевом адресе, три подряд: 262, 725, 879 мс — и это
 * отказной путь, успешный делает ещё и чтение `users`. Для игрока это не
 * «медленно», а «долго крутится пустое», потому что ни расписание, ни
 * новости в это время даже не запрошены.
 *
 * С памяткой подписчик видит экран сразу, а проверка идёт следом и
 * поправляет: список матчей и ворота грузятся ПАРАЛЛЕЛЬНО, а не по очереди.
 *
 * ⚠️ ЭТО НЕ ДЫРА В ЗАЩИТЕ, И ВОТ ПОЧЕМУ. Владелец сам провёл границу: «Ворота
 * Pro — это ворота экрана, а не защита данных». Настоящая защита — `require_pro()`
 * внутри самих RPC (supabase/migrations/require_pro_gate.sql): подделанная
 * памятка откроет РАМКУ экрана, а данные за ней сервер всё равно не отдаст —
 * 42501 `pro_required`. Проверено отрицательным контролем в check-prod
 * («Ворота Pro: подделка не проходит»).
 *
 * ⚠️ КЛЮЧ — ПО ИГРОКУ, А НЕ ОДИН НА УСТРОЙСТВО. Иначе на общем телефоне
 * подписка одного открывала бы экраны другому. Идентификатор берётся из
 * initData БЕЗ проверки подписи — здесь он только ключ памятки, а не
 * основание пускать: подделать его значит получить чужой промах памятки.
 *
 * ⚠️ СРОК ГОДНОСТИ ОБЯЗАТЕЛЕН. Без него отменённая подписка держала бы экраны
 * открытыми у того, кто больше не выходит в сеть. Неделя — компромисс: столько
 * длится офлайн, после которого честнее спросить сервер заново.
 */

const PREFIX = 'sherlock.pro.';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedPro {
  isPro: boolean;
  gamesPlayed: number;
}

interface Stored extends CachedPro {
  at: number;
}

/**
 * Идентификатор игрока из initData — ТОЛЬКО как ключ памятки.
 *
 * Возвращает null, если его нет или строка не разбирается: тогда памятки
 * просто не будет, и экран поведёт себя как сегодня.
 */
export function cacheKey(initData: string): string | null {
  if (!initData) return null;
  try {
    const user = new URLSearchParams(initData).get('user');
    if (!user) return null;
    const id = (JSON.parse(user) as { id?: unknown }).id;
    return typeof id === 'number' && Number.isFinite(id) ? PREFIX + id : null;
  } catch {
    return null;
  }
}

/** Памятка, если она есть и не просрочена. Любой сбой хранилища — это null. */
export function readProCache(initData: string, now = Date.now()): CachedPro | null {
  const key = cacheKey(initData);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    if (typeof s.isPro !== 'boolean' || typeof s.at !== 'number') return null;
    if (now - s.at > TTL_MS || s.at > now) return null;
    return { isPro: s.isPro, gamesPlayed: typeof s.gamesPlayed === 'number' ? s.gamesPlayed : 0 };
  } catch {
    return null;
  }
}

/** Запомнить ответ сервера. Сбой хранилища ничего не ломает: памятка — добавка. */
export function writeProCache(initData: string, v: CachedPro, now = Date.now()): void {
  const key = cacheKey(initData);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ ...v, at: now } satisfies Stored));
  } catch {
    /* приватный режим, переполненное хранилище — не повод падать */
  }
}

/** Забыть памятку: сервер ответил «не подписчик» или identity пропала. */
export function clearProCache(initData: string): void {
  const key = cacheKey(initData);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* см. выше */
  }
}
