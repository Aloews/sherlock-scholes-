// Соревновательный режим арены — чистая часть, без сети.
//
// ПОЧЕМУ ИСХОД СЧИТАЕТСЯ ЗДЕСЬ, А НЕ В ЭКРАНЕ. Хост и гость приходят к концу
// матча по-разному: у хоста есть `winner` из игрового цикла, у гостя только
// счёт из присланных снимков. Если каждый решит сам, «кто выиграл» окажется
// написано в двух местах — и разойдётся ровно тогда, когда это будет стоить
// очков. Обе половины спрашивают одну функцию.

import type { Side } from './net';

/** До скольки идёт матч. Совпадает с WIN_SCORE игрового цикла. */
export const RANKED_WIN_SCORE = 5;

export interface Outcome {
  /** Сколько забил Я. */
  scored: number;
  /** Сколько пропустил Я. */
  conceded: number;
  won: boolean;
}

/**
 * Исход матча с моей стороны, или null — если матч ещё идёт.
 *
 * ⚠️ СЧЁТ ПЕРЕВОРАЧИВАЕТСЯ ПОД СТОРОНУ. В `ArenaState` он всегда
 * `{ left, right }` — это про поле, а не про меня. Гость играет справа, и
 * отправить ему счёт как есть значило бы отдать серверу зеркальную заявку:
 * встречная проверка её не подтвердит, и оба матча повиснут в `pending`.
 * Ошибка при этом выглядела бы как «сервер не засчитывает», а не как
 * перепутанные стороны.
 */
export function matchOutcome(
  score: { left: number; right: number },
  mySide: Side,
  winScore = RANKED_WIN_SCORE,
): Outcome | null {
  const scored = mySide === 'left' ? score.left : score.right;
  const conceded = mySide === 'left' ? score.right : score.left;
  if (scored < winScore && conceded < winScore) return null;
  return { scored, conceded, won: scored > conceded };
}

/** Ответы `record_arena_result`. Строки, а не булево: они разные по смыслу. */
export type RankedStatus =
  /** Записано, но соперник ещё не подтвердил — в таблицу не идёт. */
  | 'pending'
  /** Обе половины сошлись зеркально. */
  | 'confirmed'
  | 'unauthorized'
  | 'bad_code'
  | 'bad_score'
  /** Сеть или РПЦ не ответили. */
  | 'failed';

/**
 * Известен ли этот ответ.
 *
 * Незнакомая строка — это не «всё хорошо»: функция могла обзавестись новым
 * отказом, и молча считать его успехом значит показать игроку зачтённый матч,
 * которого нет в таблице.
 */
export function isRankedStatus(value: unknown): value is RankedStatus {
  return (
    value === 'pending' || value === 'confirmed' || value === 'unauthorized' ||
    value === 'bad_code' || value === 'bad_score' || value === 'failed'
  );
}
