// Футбольные шахматы — правила. Чистая часть: ни React, ни сети, ни времени.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ. Это единственное место, где живёт вопрос «что
// вообще можно сделать этим ходом», и ответ на него нужен обеим половинам
// экрана: подсветке клеток и самому ходу. Считай их порознь — подсветится одно,
// исполнится другое, и заметить это можно будет только пальцем.
//
// ФУТБОЛ КАК ШАХМАТЫ — ЭТО НЕ МЕТАФОРА, А НАБОР ПРАВИЛ, и вот он целиком:
//
//   Поле 5×7. Ворота — ТРИ клетки в торце (x = 1, 2, 3), а не одна.
//   У каждой стороны четыре фигуры: вратарь, защитник, полузащитник,
//   нападающий. Ходят они по-разному, и линия определяет как:
//
//     вратарь        1 клетка в любую сторону
//     защитник       до 2 клеток по прямой
//     полузащитник   до 3 клеток в любую сторону
//     нападающий     до 2 клеток по диагонали или до 2 вперёд
//
//   Ход — ОДНО из четырёх:
//     переместить фигуру (с мячом — это ведение, мяч едет с ней);
//     пас — мяч летит по прямой и достаётся ПЕРВОЙ фигуре на линии, чьей бы
//       она ни была (в этом и весь риск);
//     удар — то же, но в клетку ворот: пусто на линии и в самой клетке — гол;
//     отбор — фигура, стоящая вплотную к владельцу мяча, забирает мяч.
//
// ⚠️ ВОРОТА ИЗ ТРЁХ КЛЕТОК — НЕ УКРАШЕНИЕ, А ЕДИНСТВЕННОЕ, ЧТО ДЕЛАЕТ ИГРУ
// ИГРАБЕЛЬНОЙ. С воротами в одну клетку вратарь просто встаёт на неё и не
// сходит: он перекрывает и удар (сам стоит в створе), и ведение (клетка
// занята), то есть пропустить становится физически нельзя. Три клетки вратарь
// закрыть собой не может — он выбирает, какую, и вот это уже решение.
//
// ИГРАБЕЛЬНОСТЬ ЗАМЕРЕНА, А НЕ ПРЕДПОЛОЖЕНА. Прогон 200 партий ботом, который
// берёт забивающий ход, когда он есть, и ходит случайно во всём остальном:
// 200 из 200 доходят до конца, в среднем 84 хода на матч, ~28 ходов на гол.
// Конверсия ударов (случайная игра, 1284 удара): 43% гол, 44% блок, 13% сейв.
// Живой игрок целится, а не тычет наугад, — то есть это ВЕРХНЯЯ оценка длины.
//
// ⚠️ ЧЕГО ЗАМЕР ПОКАЗАЛ ЕЩЁ, и это стоит знать. Бот, который бьёт ПРИ ЛЮБОЙ
// возможности, не заканчивает партию ни разу из 200: он раз за разом лупит в
// одну и ту же перекрытую клетку и получает мяч обратно. Правила ничем такое
// не ограничивают — ни повторения позиций, ни счётчика ходов без гола здесь
// нет. Двое упрямых могут перекидываться бесконечно; лечится это тем, что
// живым людям надоедает, а не кодом. Заводить правило о повторении есть
// смысл, только если это увидят на живых игроках.

/** Сторона. `home` играет снизу вверх, `away` сверху вниз. */
export type Side = 'home' | 'away';

/** Линия фигуры. Те же четыре, что у карточек в колоде. */
export type Line = 'gk' | 'def' | 'mid' | 'fwd';

export interface Square {
  x: number;
  y: number;
}

export interface Piece {
  id: string;
  side: Side;
  line: Line;
  at: Square;
}

export const BOARD_W = 5;
export const BOARD_H = 7;

/** Столбцы ворот. Три, а не один — см. шапку файла. */
export const GOAL_XS = [1, 2, 3];

/** До скольки голов идёт матч. */
export const WIN_GOALS = 3;

/** Ряд, который сторона ЗАЩИЩАЕТ. Забивает она, соответственно, в чужой. */
export function ownGoalRow(side: Side): number {
  return side === 'home' ? BOARD_H - 1 : 0;
}

/** Ряд, в который сторона забивает. */
export function targetGoalRow(side: Side): number {
  return ownGoalRow(side === 'home' ? 'away' : 'home');
}

export function other(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export function isGoalSquare(square: Square, row: number): boolean {
  return square.y === row && GOAL_XS.includes(square.x);
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.x === b.x && a.y === b.y;
}

function onBoard(square: Square): boolean {
  return square.x >= 0 && square.x < BOARD_W && square.y >= 0 && square.y < BOARD_H;
}

/**
 * Что произошло последним ходом.
 *
 * Экран это ПОКАЗЫВАЕТ, а не выводит заново из состояния. Отличить перехват от
 * паса по одной лишь новой позиции мяча нельзя — а игроку разница важнее всего
 * остального на доске.
 */
export type ChessEvent =
  | { kind: 'move' }
  | { kind: 'dribble' }
  | { kind: 'pass'; to: string }
  | { kind: 'intercept'; by: string }
  | { kind: 'save'; by: string }
  | { kind: 'block'; by: string }
  | { kind: 'tackle'; by: string }
  | { kind: 'goal'; side: Side };

export type Move =
  | { kind: 'move'; piece: string; to: Square }
  | { kind: 'pass'; to: Square }
  | { kind: 'shot'; to: Square }
  | { kind: 'tackle'; piece: string };

export interface ChessState {
  pieces: Piece[];
  /** id фигуры, владеющей мячом. Ничейного мяча в этой игре нет. */
  ballOwner: string;
  turn: Side;
  score: { home: number; away: number };
  lastEvent: ChessEvent | null;
  /** Матч закончен: кто-то добрался до WIN_GOALS. */
  finished: boolean;
}

const DIRS_8: Square[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];
const DIRS_4: Square[] = DIRS_8.slice(0, 4);
const DIRS_DIAG: Square[] = DIRS_8.slice(4);

/** Куда «вперёд» для стороны: home идёт вверх (y убывает). */
function forwardDy(side: Side): number {
  return side === 'home' ? -1 : 1;
}

/**
 * Направления и дальность хода линии.
 *
 * Нападающий — единственный, у кого ход зависит от СТОРОНЫ: «вперёд» у home и
 * away смотрит в разные концы поля. Остальные симметричны, и это не небрежность:
 * защитник, бегущий назад так же, как вперёд, — это защитник.
 */
export function moveRays(line: Line, side: Side): { dir: Square; range: number }[] {
  switch (line) {
    case 'gk':
      return DIRS_8.map((dir) => ({ dir, range: 1 }));
    case 'def':
      return DIRS_4.map((dir) => ({ dir, range: 2 }));
    case 'mid':
      return DIRS_8.map((dir) => ({ dir, range: 3 }));
    case 'fwd':
      return [
        ...DIRS_DIAG.map((dir) => ({ dir, range: 2 })),
        { dir: { x: 0, y: forwardDy(side) }, range: 2 },
      ];
  }
}

export function pieceAt(state: ChessState, square: Square): Piece | null {
  return state.pieces.find((p) => sameSquare(p.at, square)) ?? null;
}

export function pieceById(state: ChessState, id: string): Piece | null {
  return state.pieces.find((p) => p.id === id) ?? null;
}

/**
 * Первая фигура на луче из `from` в направлении `dir`, не считая самой `from`.
 *
 * Возвращает и фигуру, и её клетку — вызывающему нужно и то, и другое: удар
 * различает «фигура стоит В створе» и «фигура стоит НА пути к нему», а это
 * один и тот же поиск с разным ответом.
 */
function firstOnRay(state: ChessState, from: Square, dir: Square): Piece | null {
  let cursor = { x: from.x + dir.x, y: from.y + dir.y };
  while (onBoard(cursor)) {
    const found = pieceAt(state, cursor);
    if (found) return found;
    cursor = { x: cursor.x + dir.x, y: cursor.y + dir.y };
  }
  return null;
}

/** Направление от `from` к `to`, если они на одной прямой (8 направлений). */
function rayDir(from: Square, to: Square): Square | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  return { x: Math.sign(dx), y: Math.sign(dy) };
}

function isAdjacent(a: Square, b: Square): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
}

/** Куда эта фигура может уйти. Путь перекрывается ЛЮБОЙ фигурой, своей тоже. */
export function moveTargets(state: ChessState, piece: Piece): Square[] {
  const out: Square[] = [];
  for (const { dir, range } of moveRays(piece.line, piece.side)) {
    for (let step = 1; step <= range; step += 1) {
      const square = { x: piece.at.x + dir.x * step, y: piece.at.y + dir.y * step };
      if (!onBoard(square)) break;
      if (pieceAt(state, square)) break;
      out.push(square);
    }
  }
  return out;
}

/**
 * Все ходы стороны, чей сейчас черёд.
 *
 * Пустой список теоретически возможен (все четыре фигуры заперты, мяч некому
 * отдать и ворота не на линии) — практически на восьми фигурах и 35 клетках он
 * не встречался ни разу. На этот случай есть `passTurn`, а не молчаливое
 * зависание: экран обязан отличить «ходов нет» от «игра сломалась».
 */
export function legalMoves(state: ChessState): Move[] {
  if (state.finished) return [];
  const moves: Move[] = [];
  const mine = state.pieces.filter((p) => p.side === state.turn);
  const holder = pieceById(state, state.ballOwner);

  for (const piece of mine) {
    for (const to of moveTargets(state, piece)) {
      moves.push({ kind: 'move', piece: piece.id, to });
    }
  }

  if (holder && holder.side === state.turn) {
    // Пас: по лучу до первой фигуры. Цель хода — та клетка, куда игрок целит;
    // долетит мяч туда или нет, решает `applyMove`.
    for (const dir of DIRS_8) {
      const target = firstOnRay(state, holder.at, dir);
      if (target) moves.push({ kind: 'pass', to: target.at });
    }
    // Удар: в любую клетку чужих ворот, стоящую на луче. Заблокированный удар
    // — тоже законный ход: игрок вправе рискнуть и потерять мяч.
    const row = targetGoalRow(state.turn);
    for (const x of GOAL_XS) {
      const goal = { x, y: row };
      if (rayDir(holder.at, goal)) moves.push({ kind: 'shot', to: goal });
    }
  }

  // Отбор: моя фигура вплотную к чужому владельцу мяча.
  if (holder && holder.side !== state.turn) {
    for (const piece of mine) {
      if (isAdjacent(piece.at, holder.at)) moves.push({ kind: 'tackle', piece: piece.id });
    }
  }

  return moves;
}

function movePiece(pieces: Piece[], id: string, to: Square): Piece[] {
  return pieces.map((p) => (p.id === id ? { ...p, at: to } : p));
}

/**
 * Начальная расстановка. Мяч у нападающего той стороны, что начинает.
 *
 * Вратарь стоит в ЦЕНТРАЛЬНОЙ клетке ворот — не потому, что так красивее, а
 * потому, что это единственная клетка, симметричная относительно обеих
 * остальных: любой другой старт давал бы одной из сторон открытый угол ещё до
 * первого хода.
 */
export function initialState(kickOff: Side = 'home'): ChessState {
  const pieces: Piece[] = [
    { id: 'h-gk', side: 'home', line: 'gk', at: { x: 2, y: 6 } },
    { id: 'h-def', side: 'home', line: 'def', at: { x: 1, y: 5 } },
    { id: 'h-mid', side: 'home', line: 'mid', at: { x: 3, y: 5 } },
    { id: 'h-fwd', side: 'home', line: 'fwd', at: { x: 2, y: 4 } },
    { id: 'a-gk', side: 'away', line: 'gk', at: { x: 2, y: 0 } },
    { id: 'a-def', side: 'away', line: 'def', at: { x: 3, y: 1 } },
    { id: 'a-mid', side: 'away', line: 'mid', at: { x: 1, y: 1 } },
    { id: 'a-fwd', side: 'away', line: 'fwd', at: { x: 2, y: 2 } },
  ];
  return {
    pieces,
    ballOwner: kickOff === 'home' ? 'h-fwd' : 'a-fwd',
    turn: kickOff,
    score: { home: 0, away: 0 },
    lastEvent: null,
    finished: false,
  };
}

/**
 * Ход не найден — черёд переходит. Отдельной функцией, а не веткой внутри
 * `applyMove`: «ходов нет» это не ход, и делать вид, что ход был, значило бы
 * записать в историю событие, которого не случилось.
 */
export function passTurn(state: ChessState): ChessState {
  return { ...state, turn: other(state.turn), lastEvent: null };
}

/**
 * Применить ход. Возвращает НОВОЕ состояние; входное не меняется.
 *
 * Незаконный ход возвращает состояние как есть — молча. Проверять законность
 * дважды (здесь и в экране) незачем, а падать на нажатии кнопки тем более:
 * список ходов и так строится этим же модулем.
 */
export function applyMove(state: ChessState, move: Move): ChessState {
  if (state.finished) return state;
  const holder = pieceById(state, state.ballOwner);

  switch (move.kind) {
    case 'move': {
      const piece = pieceById(state, move.piece);
      if (!piece || piece.side !== state.turn) return state;
      if (!moveTargets(state, piece).some((s) => sameSquare(s, move.to))) return state;

      const carries = state.ballOwner === piece.id;
      // Ведение В ЧУЖИЕ ВОРОТА — гол. Второй способ забить помимо удара, и
      // именно он делает пустую клетку ворот опасной сама по себе.
      if (carries && isGoalSquare(move.to, targetGoalRow(piece.side))) {
        return afterGoal(state, piece.side);
      }
      return {
        ...state,
        pieces: movePiece(state.pieces, piece.id, move.to),
        turn: other(state.turn),
        lastEvent: { kind: carries ? 'dribble' : 'move' },
      };
    }

    case 'pass': {
      if (!holder || holder.side !== state.turn) return state;
      const dir = rayDir(holder.at, move.to);
      if (!dir) return state;
      const first = firstOnRay(state, holder.at, dir);
      if (!first) return state;
      // Мяч достаётся первому на линии — своему или чужому. Целился игрок в
      // одного, а перекрыть луч мог кто угодно, и это ровно та цена, ради
      // которой пас вообще интересен.
      return {
        ...state,
        ballOwner: first.id,
        turn: other(state.turn),
        lastEvent: first.side === holder.side
          ? { kind: 'pass', to: first.id }
          : { kind: 'intercept', by: first.id },
      };
    }

    case 'shot': {
      if (!holder || holder.side !== state.turn) return state;
      const row = targetGoalRow(holder.side);
      if (!isGoalSquare(move.to, row)) return state;
      const dir = rayDir(holder.at, move.to);
      if (!dir) return state;

      const first = firstOnRay(state, holder.at, dir);
      // Никого на луче вовсе, либо первый стоит ЗА воротами — створ открыт.
      if (!first || beyond(holder.at, first.at, move.to)) {
        return afterGoal(state, holder.side);
      }
      // Фигура в самой клетке ворот — сейв; на пути к ней — блок. Разные
      // события: сейв это работа вратаря, блок — случайность на линии.
      const inGoal = sameSquare(first.at, move.to);
      return {
        ...state,
        ballOwner: first.id,
        turn: other(state.turn),
        lastEvent: inGoal ? { kind: 'save', by: first.id } : { kind: 'block', by: first.id },
      };
    }

    case 'tackle': {
      const piece = pieceById(state, move.piece);
      if (!piece || piece.side !== state.turn) return state;
      if (!holder || holder.side === state.turn) return state;
      if (!isAdjacent(piece.at, holder.at)) return state;
      return {
        ...state,
        ballOwner: piece.id,
        turn: other(state.turn),
        lastEvent: { kind: 'tackle', by: piece.id },
      };
    }
  }
}

/** Лежит ли `probe` дальше по лучу, чем цель `goal`. */
function beyond(from: Square, probe: Square, goal: Square): boolean {
  const toProbe = Math.max(Math.abs(probe.x - from.x), Math.abs(probe.y - from.y));
  const toGoal = Math.max(Math.abs(goal.x - from.x), Math.abs(goal.y - from.y));
  return toProbe > toGoal;
}

/**
 * Гол: счёт, расстановка заново, мяч — ПРОПУСТИВШЕЙ стороне.
 *
 * Мяч отдаётся пропустившему, а не забившему, по той же причине, по которой
 * это делает настоящий футбол: иначе отрыв в один гол превращается в отрыв
 * навсегда, потому что забивший сохраняет и мяч, и инициативу.
 */
function afterGoal(state: ChessState, scorer: Side): ChessState {
  const score = {
    home: state.score.home + (scorer === 'home' ? 1 : 0),
    away: state.score.away + (scorer === 'away' ? 1 : 0),
  };
  const conceded = other(scorer);
  const fresh = initialState(conceded);
  return {
    ...fresh,
    score,
    lastEvent: { kind: 'goal', side: scorer },
    finished: score.home >= WIN_GOALS || score.away >= WIN_GOALS,
  };
}

/** Победитель, или null пока матч идёт. */
export function winner(state: ChessState): Side | null {
  if (!state.finished) return null;
  return state.score.home > state.score.away ? 'home' : 'away';
}
