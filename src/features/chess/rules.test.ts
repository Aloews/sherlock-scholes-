import { describe, it, expect } from 'vitest';
import {
  BOARD_H, BOARD_W, GOAL_XS, WIN_GOALS,
  applyMove, initialState, legalMoves, moveTargets, pieceById, passTurn,
  targetGoalRow, ownGoalRow, isGoalSquare, other, winner,
  type ChessState, type Piece, type Square,
} from './rules';

/**
 * Правила футбольных шахмат.
 *
 * ЧТО ЗДЕСЬ ЗАКРЕПЛЯЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО. Настолка ломается не падением, а
 * тем, что ход, который игрок считает законным, исполняется иначе — и понять,
 * что случилось, по доске нельзя. Поэтому тесты стоят не на «функция не
 * упала», а на исходах, которые игрок ВИДИТ и по которым принимает решения:
 * долетел пас или его перехватили, сейв это или блок, засчитан гол или нет.
 */

/** Доска под конкретный случай: только те фигуры, что нужны утверждению. */
function board(pieces: Piece[], ballOwner: string, turn: ChessState['turn']): ChessState {
  return {
    pieces,
    ballOwner,
    turn,
    score: { home: 0, away: 0 },
    lastEvent: null,
    finished: false,
  };
}

const at = (x: number, y: number): Square => ({ x, y });

describe('геометрия поля', () => {
  it('ворота — ТРИ клетки, а не одна', () => {
    // С воротами в одну клетку вратарь встаёт на неё и не сходит: он
    // перекрывает и удар, и ведение, то есть пропустить нельзя физически.
    expect(GOAL_XS).toHaveLength(3);
    expect(GOAL_XS.every((x) => x >= 0 && x < BOARD_W)).toBe(true);
  });

  it('стороны защищают противоположные торцы', () => {
    expect(ownGoalRow('home')).toBe(BOARD_H - 1);
    expect(ownGoalRow('away')).toBe(0);
    expect(targetGoalRow('home')).toBe(0);
    expect(targetGoalRow('away')).toBe(BOARD_H - 1);
  });

  it('клетка ворот — только в своём ряду и только в створе', () => {
    expect(isGoalSquare(at(2, 0), 0)).toBe(true);
    expect(isGoalSquare(at(0, 0), 0)).toBe(false);  // угол, вне створа
    expect(isGoalSquare(at(2, 1), 0)).toBe(false);  // не тот ряд
  });
});

describe('ходы линий', () => {
  it('вратарь — ровно одна клетка в любую сторону', () => {
    const gk: Piece = { id: 'g', side: 'home', line: 'gk', at: at(2, 3) };
    const targets = moveTargets(board([gk], 'g', 'home'), gk);
    expect(targets).toHaveLength(8);
    expect(targets.every((s) => Math.abs(s.x - 2) <= 1 && Math.abs(s.y - 3) <= 1)).toBe(true);
  });

  it('защитник ходит по прямой и НЕ ходит по диагонали', () => {
    const def: Piece = { id: 'd', side: 'home', line: 'def', at: at(2, 3) };
    const targets = moveTargets(board([def], 'd', 'home'), def);
    expect(targets.some((s) => s.x !== 2 && s.y !== 3)).toBe(false);
    expect(targets).toContainEqual(at(2, 1));  // две вверх
    expect(targets).not.toContainEqual(at(2, 0)); // три — уже нет
  });

  it('нападающий ходит вперёд, но не назад по прямой', () => {
    // «Вперёд» у home — вверх (y убывает). Назад по прямой ему нельзя: это и
    // отличает его от полузащитника, который ходит в любую сторону.
    const fwd: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 3) };
    const targets = moveTargets(board([fwd], 'f', 'home'), fwd);
    expect(targets).toContainEqual(at(2, 2));
    expect(targets).toContainEqual(at(2, 1));
    expect(targets).not.toContainEqual(at(2, 4));
    expect(targets).toContainEqual(at(3, 4));   // назад по диагонали — можно
  });

  it('«вперёд» у away смотрит в другую сторону', () => {
    const fwd: Piece = { id: 'f', side: 'away', line: 'fwd', at: at(2, 3) };
    const targets = moveTargets(board([fwd], 'f', 'away'), fwd);
    expect(targets).toContainEqual(at(2, 4));
    expect(targets).not.toContainEqual(at(2, 2));
  });

  it('ЛЮБАЯ фигура перекрывает путь, своя тоже', () => {
    const mid: Piece = { id: 'm', side: 'home', line: 'mid', at: at(2, 3) };
    const blocker: Piece = { id: 'b', side: 'home', line: 'def', at: at(2, 2) };
    const targets = moveTargets(board([mid, blocker], 'm', 'home'), mid);
    expect(targets).not.toContainEqual(at(2, 2)); // занято
    expect(targets).not.toContainEqual(at(2, 1)); // за спиной своего же
    expect(targets).toContainEqual(at(2, 4));     // в другую сторону — свободно
  });

  it('за край доски фигура не уходит', () => {
    const mid: Piece = { id: 'm', side: 'home', line: 'mid', at: at(0, 0) };
    const targets = moveTargets(board([mid], 'm', 'home'), mid);
    expect(targets.every((s) => s.x >= 0 && s.x < BOARD_W && s.y >= 0 && s.y < BOARD_H)).toBe(true);
  });
});

describe('пас', () => {
  it('долетает до своего на линии', () => {
    const from: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const mate: Piece = { id: 'm', side: 'home', line: 'mid', at: at(2, 1) };
    const next = applyMove(board([from, mate], 'f', 'home'), { kind: 'pass', to: at(2, 1) });
    expect(next.ballOwner).toBe('m');
    expect(next.lastEvent).toEqual({ kind: 'pass', to: 'm' });
    expect(next.turn).toBe('away');
  });

  it('ПЕРЕХВАТЫВАЕТСЯ ЧУЖИМ, который стоит на линии раньше своего', () => {
    // Это и есть цена паса: целились в своего, а луч перекрыл соперник.
    // Отличить это от удавшегося паса по одной новой позиции мяча нельзя,
    // поэтому событие называется отдельно.
    const from: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const enemy: Piece = { id: 'e', side: 'away', line: 'def', at: at(2, 3) };
    const mate: Piece = { id: 'm', side: 'home', line: 'mid', at: at(2, 1) };
    const next = applyMove(board([from, enemy, mate], 'f', 'home'), { kind: 'pass', to: at(2, 1) });
    expect(next.ballOwner).toBe('e');
    expect(next.lastEvent).toEqual({ kind: 'intercept', by: 'e' });
  });

  it('в пустоту не пасуют — такого хода нет', () => {
    const lone: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const state = board([lone], 'f', 'home');
    expect(legalMoves(state).some((m) => m.kind === 'pass')).toBe(false);
    // И принудительный вызов ничего не меняет: мячу некуда лететь.
    expect(applyMove(state, { kind: 'pass', to: at(2, 0) })).toBe(state);
  });

  it('не по прямой пас невозможен', () => {
    const from: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const mate: Piece = { id: 'm', side: 'home', line: 'mid', at: at(3, 1) };
    const state = board([from, mate], 'f', 'home');
    expect(applyMove(state, { kind: 'pass', to: at(3, 1) })).toBe(state);
  });
});

describe('удар', () => {
  it('пустой створ — ГОЛ', () => {
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 3) };
    const next = applyMove(board([striker], 'f', 'home'), { kind: 'shot', to: at(2, 0) });
    expect(next.score.home).toBe(1);
    expect(next.lastEvent).toEqual({ kind: 'goal', side: 'home' });
  });

  it('фигура В СТВОРЕ — сейв, а не гол', () => {
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 3) };
    const keeper: Piece = { id: 'k', side: 'away', line: 'gk', at: at(2, 0) };
    const next = applyMove(board([striker, keeper], 'f', 'home'), { kind: 'shot', to: at(2, 0) });
    expect(next.score.home).toBe(0);
    expect(next.ballOwner).toBe('k');
    expect(next.lastEvent).toEqual({ kind: 'save', by: 'k' });
  });

  it('фигура НА ПУТИ к воротам — блок, и это другое событие', () => {
    // Сейв — работа вратаря, блок — случайность на линии. Игрок должен
    // видеть разницу: во втором случае створ был открыт, и виноват выбор угла.
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const inTheWay: Piece = { id: 'b', side: 'away', line: 'def', at: at(2, 2) };
    const next = applyMove(board([striker, inTheWay], 'f', 'home'), { kind: 'shot', to: at(2, 0) });
    expect(next.lastEvent).toEqual({ kind: 'block', by: 'b' });
    expect(next.ballOwner).toBe('b');
  });

  it('ВРАТАРЬ ЗАКРЫВАЕТ СОБОЙ ОДНУ КЛЕТКУ ВОРОТ, НЕ ВСЕ ТРИ', () => {
    // Ровно ради этого ворота сделаны из трёх клеток. Вратарь в центре —
    // угловые створы открыты, и бьющему есть что выбирать.
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(1, 3) };
    const keeper: Piece = { id: 'k', side: 'away', line: 'gk', at: at(2, 0) };
    const state = board([striker, keeper], 'f', 'home');
    const scored = applyMove(state, { kind: 'shot', to: at(1, 0) });
    expect(scored.score.home).toBe(1);
  });

  it('за спиной вратаря никого нет — фигура ЗА воротами удару не мешает', () => {
    // Луч упирается в край доски; «первый на луче» может оказаться дальше
    // самой цели, и считать это блоком было бы неправдой.
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 3) };
    const behind: Piece = { id: 'x', side: 'away', line: 'def', at: at(2, 5) };
    const next = applyMove(board([striker, behind], 'f', 'home'), { kind: 'shot', to: at(2, 0) });
    expect(next.score.home).toBe(1);
  });

  it('бить можно только по створу на прямой', () => {
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(0, 3) };
    const shots = legalMoves(board([striker], 'f', 'home')).filter((m) => m.kind === 'shot');
    // (0,3) → (1,0) не прямая и не диагональ; (3,0) — диагональ, годится.
    expect(shots.map((m) => (m as { to: Square }).to)).toContainEqual(at(3, 0));
    expect(shots.map((m) => (m as { to: Square }).to)).not.toContainEqual(at(1, 0));
  });
});

describe('ведение и отбор', () => {
  it('фигура с мячом везёт его с собой', () => {
    const carrier: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const next = applyMove(board([carrier], 'f', 'home'), { kind: 'move', piece: 'f', to: at(2, 3) });
    expect(next.ballOwner).toBe('f');
    expect(pieceById(next, 'f')!.at).toEqual(at(2, 3));
    expect(next.lastEvent).toEqual({ kind: 'dribble' });
  });

  it('ведение В ПУСТЫЕ ВОРОТА — тоже гол', () => {
    const carrier: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 1) };
    const next = applyMove(board([carrier], 'f', 'home'), { kind: 'move', piece: 'f', to: at(2, 0) });
    expect(next.score.home).toBe(1);
    expect(next.lastEvent).toEqual({ kind: 'goal', side: 'home' });
  });

  it('фигура БЕЗ мяча его не увозит', () => {
    const carrier: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const other_: Piece = { id: 'd', side: 'home', line: 'def', at: at(0, 4) };
    const next = applyMove(board([carrier, other_], 'f', 'home'),
      { kind: 'move', piece: 'd', to: at(0, 3) });
    expect(next.ballOwner).toBe('f');
    expect(next.lastEvent).toEqual({ kind: 'move' });
  });

  it('отбор забирает мяч у соседа', () => {
    const enemy: Piece = { id: 'e', side: 'away', line: 'fwd', at: at(2, 3) };
    const mine: Piece = { id: 'd', side: 'home', line: 'def', at: at(2, 4) };
    const next = applyMove(board([enemy, mine], 'e', 'home'), { kind: 'tackle', piece: 'd' });
    expect(next.ballOwner).toBe('d');
    expect(next.lastEvent).toEqual({ kind: 'tackle', by: 'd' });
  });

  it('издалека не отбирают', () => {
    const enemy: Piece = { id: 'e', side: 'away', line: 'fwd', at: at(2, 1) };
    const mine: Piece = { id: 'd', side: 'home', line: 'def', at: at(2, 4) };
    const state = board([enemy, mine], 'e', 'home');
    expect(legalMoves(state).some((m) => m.kind === 'tackle')).toBe(false);
    expect(applyMove(state, { kind: 'tackle', piece: 'd' })).toBe(state);
  });

  it('свой мяч у себя не отбирают', () => {
    const mine: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 4) };
    const mate: Piece = { id: 'd', side: 'home', line: 'def', at: at(2, 3) };
    const state = board([mine, mate], 'f', 'home');
    expect(legalMoves(state).some((m) => m.kind === 'tackle')).toBe(false);
  });
});

describe('очерёдность и чужие фигуры', () => {
  it('чужой фигурой не ходят', () => {
    const state = initialState('home');
    const before = pieceById(state, 'a-fwd')!.at;
    const next = applyMove(state, { kind: 'move', piece: 'a-fwd', to: at(2, 3) });
    expect(next).toBe(state);
    expect(pieceById(state, 'a-fwd')!.at).toEqual(before);
  });

  it('каждый ход передаёт черёд', () => {
    const state = initialState('home');
    const move = legalMoves(state).find((m) => m.kind === 'move')!;
    expect(applyMove(state, move).turn).toBe('away');
  });

  it('все ходы из legalMoves действительно применяются', () => {
    // Список ходов строит тот же модуль, что их исполняет. Разойдись они — на
    // экране подсветилось бы одно, а нажатие не делало бы ничего.
    const state = initialState('home');
    for (const move of legalMoves(state)) {
      expect(applyMove(state, move)).not.toBe(state);
    }
  });

  it('состояние на входе не меняется', () => {
    const state = initialState('home');
    const snapshot = JSON.stringify(state);
    applyMove(state, legalMoves(state)[0]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('passTurn отдаёт черёд, не выдумывая события', () => {
    const state = initialState('home');
    const next = passTurn(state);
    expect(next.turn).toBe('away');
    expect(next.lastEvent).toBeNull();
    expect(next.pieces).toEqual(state.pieces);
  });
});

describe('гол и конец матча', () => {
  it('после гола расстановка сбрасывается, мяч у ПРОПУСТИВШЕЙ стороны', () => {
    // Иначе отрыв в один гол превращается в отрыв навсегда: забивший
    // сохранял бы и мяч, и инициативу.
    const striker: Piece = { id: 'f', side: 'home', line: 'fwd', at: at(2, 3) };
    const next = applyMove(board([striker], 'f', 'home'), { kind: 'shot', to: at(2, 0) });
    expect(next.turn).toBe('away');
    expect(next.ballOwner).toBe('a-fwd');
    expect(next.pieces).toHaveLength(8);
  });

  it('матч заканчивается на WIN_GOALS и дальше ходов нет', () => {
    let state = initialState('home');
    state = { ...state, score: { home: WIN_GOALS - 1, away: 0 } };
    const striker = { id: 'f', side: 'home' as const, line: 'fwd' as const, at: at(2, 3) };
    state = { ...state, pieces: [striker], ballOwner: 'f', turn: 'home' };

    const next = applyMove(state, { kind: 'shot', to: at(2, 0) });
    expect(next.score.home).toBe(WIN_GOALS);
    expect(next.finished).toBe(true);
    expect(winner(next)).toBe('home');
    expect(legalMoves(next)).toEqual([]);
    // Законченный матч не продолжается ни одним ходом.
    expect(applyMove(next, { kind: 'shot', to: at(2, 0) })).toBe(next);
  });

  it('пока матч идёт, победителя нет', () => {
    expect(winner(initialState('home'))).toBeNull();
  });
});

describe('начальная расстановка', () => {
  it('восемь фигур, по четыре линии на сторону', () => {
    const state = initialState('home');
    expect(state.pieces).toHaveLength(8);
    for (const side of ['home', 'away'] as const) {
      const lines = state.pieces.filter((p) => p.side === side).map((p) => p.line).sort();
      expect(lines).toEqual(['def', 'fwd', 'gk', 'mid']);
    }
  });

  it('вратарь стоит в ЦЕНТРАЛЬНОЙ клетке ворот', () => {
    // Любой другой старт оставлял бы одной из сторон открытый угол ещё до
    // первого хода.
    const state = initialState('home');
    for (const side of ['home', 'away'] as const) {
      const gk = state.pieces.find((p) => p.side === side && p.line === 'gk')!;
      expect(gk.at).toEqual(at(2, ownGoalRow(side)));
      expect(isGoalSquare(gk.at, ownGoalRow(side))).toBe(true);
    }
  });

  it('ни одна фигура не стоит на клетке другой', () => {
    const state = initialState('home');
    const keys = state.pieces.map((p) => `${p.at.x},${p.at.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('мяч у той стороны, что начинает', () => {
    expect(pieceById(initialState('home'), initialState('home').ballOwner)!.side).toBe('home');
    expect(pieceById(initialState('away'), initialState('away').ballOwner)!.side).toBe('away');
  });

  it('обе стороны начинают с одинаковым выбором — расстановка зеркальна', () => {
    // Считаем ходы из симметричных стартов: перекос здесь означал бы
    // преимущество, которого никто не объявлял.
    const home = legalMoves(initialState('home')).length;
    const away = legalMoves(initialState('away')).length;
    expect(home).toBe(away);
  });

  it('other() переворачивает сторону и возвращается к себе', () => {
    expect(other('home')).toBe('away');
    expect(other(other('home'))).toBe('home');
  });
});
