/**
 * Три исхода загрузки вместо двух.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ НУЖНО. По всему проекту запросы написаны так:
 *
 *   if (error) { console.error(...); return []; }
 *
 * Пустой массив означает и «данных правда нет», и «всё сломалось». Экран
 * показывает одну и ту же успокаивающую надпись в обоих случаях, а
 * console.error видит только тот, кто открыл консоль — то есть никто.
 *
 * За одну сессию это стоило трёх расследований: «нет Челси», «не попали голы
 * Суперкубка», «дайджеста не видно». Каждый раз симптом выглядел как
 * отсутствие данных, а был поломкой, и каждый раз выяснить это можно было
 * только запросом к боевой базе руками.
 *
 * `null` здесь — ЕЩЁ НЕ ЗАГРУЖЕНО, и это третье состояние, а не отсутствие
 * значения: экран, который не отличает «грузим» от «пусто», мигает пустотой
 * на каждом открытии.
 */
export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; code: string };

export const LOADING = { status: 'loading' } as const;

export const ok = <T,>(data: T): LoadState<T> => ({ status: 'ok', data });
export const failed = (code: string): LoadState<never> => ({ status: 'error', code });

/**
 * Ответ PostgREST в LoadState.
 *
 * Принимает ровно ту форму, которую отдаёт supabase-js, чтобы обёртки не
 * разбирали её каждая по-своему. Код ошибки СОХРАНЯЕТСЯ: «42501» (нет прав) и
 * «PGRST202» (нет функции) — разные поломки с разными причинами, и слить их в
 * одно «не получилось» значит снова потерять то, ради чего всё это.
 */
export function fromPostgrest<T>(
  res: { data: T | null; error: { code?: string; message: string } | null },
  where: string,
): LoadState<T> {
  if (res.error) {
    console.error(`[${where}]`, res.error.code ?? '', res.error.message);
    return failed(res.error.code ?? 'unknown');
  }
  // Успех без строк — это ok с пустотой, а не ошибка. Разница видна экрану:
  // «за сутки ничего не вышло» против «не удалось загрузить».
  return ok((res.data ?? []) as T);
}

/** Данные, если они есть, иначе — переданный запасной вариант. */
export function dataOr<T>(state: LoadState<T>, fallback: T): T {
  return state.status === 'ok' ? state.data : fallback;
}
