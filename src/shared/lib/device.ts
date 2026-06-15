// Anonymous per-install id — used ONLY to throttle abuse (card reports).
// This is NOT a Telegram user id / name: it's a random uuid kept in
// localStorage, never sent to analytics, never tied to a person. If the user
// clears storage it simply rotates. Its sole purpose is rate-limiting reports.

const KEY = 'ss_device';

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
