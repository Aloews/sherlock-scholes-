// Физика арены: два игрока, мяч, две рамки.
//
// ВСЁ ЗДЕСЬ ЧИСТОЕ И БЕЗ CANVAS. Шаг симуляции — функция из состояния и ввода в
// новое состояние, поэтому его можно проверить тестом, а не глазами. Это не
// вкусовщина: столкновения либо сохраняют импульс, либо нет, и заметить второе
// на глаз в движении невозможно — мяч просто иногда «прилипает».
//
// КООРДИНАТЫ ЛОГИЧЕСКИЕ, не пиксельные. Поле всегда PITCH_W × PITCH_H, а экран
// подгоняет масштаб. Иначе физика зависела бы от размера телефона, и на
// планшете мяч летел бы иначе, чем на маленьком экране.
//
// Ось Y вниз — как у canvas. Держать математику в «правильной» системе и
// переворачивать при отрисовке значит иметь два места, где можно ошибиться
// знаком.

export const PITCH_W = 640;
export const PITCH_H = 360;

/** Высота створа. Ворота — это дыра в боковой стене, а не отдельный объект. */
export const GOAL_H = 120;

export const PLAYER_R = 17;
export const BALL_R = 10;

/**
 * Какая ДОЛЯ СКОРОСТИ ОСТАЁТСЯ ЧЕРЕЗ СЕКУНДУ.
 *
 * У мяча больше, чем у игроков: мяч должен катиться, игрок — останавливаться,
 * когда палец отпустили. Разные значения здесь и есть разница между «футболом»
 * и «шайбами на льду».
 *
 * ЗА СЕКУНДУ, А НЕ ЗА КАДР — и это стоило переписывания. Сначала здесь стояли
 * 0.86 и 0.995: правдоподобные числа, но покадровые (столько и стоит в
 * HaxBall при 60 Гц). Применённые к секунде, они означали, что отпущенный
 * игрок катится 27 секунд, отскакивая от стен, — при комментарии, который
 * утверждал ровно обратное. На глаз это читается как «управление залипает»,
 * и никто не заподозрит константу.
 *
 * Переведено честно: 0.96^60 и 0.99^60. Игрок теряет 90% скорости меньше чем
 * за секунду и прокатывается около 95 пикселей при ширине поля 640; мяч на
 * той же скорости успевает пересечь поле.
 */
export const PLAYER_DAMPING = 0.086;
const BALL_DAMPING = 0.55;

/** Ускорение игрока от джойстика и потолок скорости. */
export const PLAYER_ACCEL = 1400;
export const PLAYER_MAX_V = 260;

/** Упругость столкновений. 1 — идеально упругое, 0 — слипание. */
const RESTITUTION = 0.75;
/** Добавка к отскоку мяча, когда игрок бьёт. Это весь «удар». */
const KICK_IMPULSE = 330;

export interface Vec { x: number; y: number }

export interface Body {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  /** Тяжёлый предмет сдвигается меньше. Игрок тяжелее мяча, иначе он от него отлетает. */
  m: number;
}

export interface ArenaState {
  left: Body;
  right: Body;
  ball: Body;
  score: { left: number; right: number };
}

export interface PlayerInput {
  /** Направление джойстика, длина 0..1. Ноль — палец отпущен. */
  move: Vec;
  /** Удар нажат в этом кадре. */
  kick: boolean;
}

export interface Inputs { left: PlayerInput; right: PlayerInput }

const NO_MOVE: Vec = { x: 0, y: 0 };
export const IDLE: PlayerInput = { move: NO_MOVE, kick: false };

function body(x: number, y: number, r: number, m: number): Body {
  return { x, y, vx: 0, vy: 0, r, m };
}

/** Начальная расстановка. Она же — расстановка после гола. */
export function kickoff(score = { left: 0, right: 0 }): ArenaState {
  return {
    left: body(PITCH_W * 0.25, PITCH_H / 2, PLAYER_R, 3),
    right: body(PITCH_W * 0.75, PITCH_H / 2, PLAYER_R, 3),
    ball: body(PITCH_W / 2, PITCH_H / 2, BALL_R, 1),
    score: { ...score },
  };
}

function len(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/**
 * Столкновение двух кругов.
 *
 * РАЗВОДИТ И МЕНЯЕТ СКОРОСТИ, и первое так же важно, как второе: если тела
 * оставить пересекающимися, следующий кадр снова увидит столкновение, они
 * обменяются импульсом ещё раз и начнут дрожать. Мяч в углу поля тогда
 * «залипает» — характерная беда наивной физики.
 *
 * Расталкивание — по массам: тяжёлый игрок сдвигает лёгкий мяч, а не наоборот.
 */
function resolve(a: Body, b: Body, extraImpulse = 0): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const overlap = a.r + b.r - dist;
  if (overlap <= 0) return;

  // Ровно совпавшие центры: направление не определено, берём любое — иначе
  // деление на ноль превращает координаты в NaN и поле исчезает целиком.
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;

  const total = a.m + b.m;
  a.x -= nx * overlap * (b.m / total);
  a.y -= ny * overlap * (b.m / total);
  b.x += nx * overlap * (a.m / total);
  b.y += ny * overlap * (a.m / total);

  // Скорость сближения вдоль нормали. Положительная — тела уже расходятся, и
  // ОТСКОК считать нельзя: иначе столкновение «сработает» второй раз и
  // добавит энергии из ниоткуда.
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const bounce = rel <= 0 ? (-(1 + RESTITUTION) * rel) / (1 / a.m + 1 / b.m) : 0;

  // А ВОТ УДАР СЧИТАЕТСЯ ВСЕГДА, пока тела соприкасаются, и раньше здесь был
  // общий выход по `rel > 0` — на нём удар и терялся. Игрок почти никогда не
  // стоит: он бежит мимо мяча и жмёт удар, и любой боковой составляющей
  // движения хватало, чтобы нормальная скорость оказалась положительной и
  // весь удар не случился вовсе. В игре это выглядит как «кнопка иногда не
  // срабатывает» — то есть как каприз, а не как правило.
  const j = bounce + extraImpulse;
  if (j === 0) return;

  a.vx -= (j * nx) / a.m;
  a.vy -= (j * ny) / a.m;
  b.vx += (j * nx) / b.m;
  b.vy += (j * ny) / b.m;
}

/** Пролетает ли тело сквозь створ на этой высоте. */
function inGoalMouth(y: number): boolean {
  return Math.abs(y - PITCH_H / 2) < GOAL_H / 2;
}

/**
 * Стены. Игроки отбиваются от всех четырёх, мяч — от всех, кроме створов.
 *
 * `passGoals` разделяет эти два случая. Без него мяч упирался бы в стену на
 * линии ворот, а гола не случалось бы никогда.
 */
function bounceWalls(b: Body, passGoals: boolean): void {
  if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * RESTITUTION; }
  if (b.y + b.r > PITCH_H) { b.y = PITCH_H - b.r; b.vy = -Math.abs(b.vy) * RESTITUTION; }

  // Одно значение на обе стены: створы стоят на одной высоте, и «пролетает
  // слева» и «пролетает справа» — это буквально одно условие.
  const throughGoal = passGoals && inGoalMouth(b.y);
  if (b.x - b.r < 0 && !throughGoal) { b.x = b.r; b.vx = Math.abs(b.vx) * RESTITUTION; }
  if (b.x + b.r > PITCH_W && !throughGoal) {
    b.x = PITCH_W - b.r;
    b.vx = -Math.abs(b.vx) * RESTITUTION;
  }
}

/**
 * Кто забил, если забил.
 *
 * Мяч должен ПЕРЕСЕЧЬ линию целиком, а не коснуться её: иначе гол засчитывается
 * в момент, когда мяч ещё видимо в поле, и это выглядит как ошибка.
 *
 * Гол в левые ворота — очко правому: ворота названы по стороне поля, а не по
 * тому, кто их защищает.
 */
export function scored(state: ArenaState): 'left' | 'right' | null {
  const { ball } = state;
  if (ball.x + ball.r < 0) return 'right';
  if (ball.x - ball.r > PITCH_W) return 'left';
  return null;
}

function drive(b: Body, input: PlayerInput, dt: number): void {
  const m = len(input.move);
  if (m > 0) {
    // Джойстик нормализуется: диагональ не должна быть быстрее прямой.
    const k = Math.min(m, 1) / m;
    b.vx += input.move.x * k * PLAYER_ACCEL * dt;
    b.vy += input.move.y * k * PLAYER_ACCEL * dt;
  }
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > PLAYER_MAX_V) {
    b.vx = (b.vx / speed) * PLAYER_MAX_V;
    b.vy = (b.vy / speed) * PLAYER_MAX_V;
  }
}

function damp(b: Body, per: number, dt: number): void {
  // Затухание за секунду, приведённое к шагу: иначе физика зависела бы от
  // частоты кадров, и на 120 Гц мяч останавливался бы вдвое быстрее.
  const k = Math.pow(per, dt);
  b.vx *= k;
  b.vy *= k;
}

/**
 * Один шаг симуляции. Возвращает НОВОЕ состояние.
 *
 * `dt` ограничен сверху вызывающим: вкладка была свёрнута полминуты, кадр
 * пришёл с dt = 30 секунд, и мяч телепортируется сквозь стену. Ограничение
 * живёт в useArena, потому что это свойство цикла, а не физики.
 */
export function step(prev: ArenaState, inputs: Inputs, dt: number): ArenaState {
  const state: ArenaState = {
    left: { ...prev.left },
    right: { ...prev.right },
    ball: { ...prev.ball },
    score: { ...prev.score },
  };

  drive(state.left, inputs.left, dt);
  drive(state.right, inputs.right, dt);

  for (const b of [state.left, state.right, state.ball]) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // Удар — это та же добавка к отскоку, только когда нажата кнопка И игрок
  // достаёт до мяча. Отдельной механики «пнуть на расстоянии» нет намеренно:
  // она превращает игру в стрельбу.
  resolve(state.left, state.ball, inputs.left.kick ? KICK_IMPULSE : 0);
  resolve(state.right, state.ball, inputs.right.kick ? KICK_IMPULSE : 0);
  resolve(state.left, state.right);

  bounceWalls(state.left, false);
  bounceWalls(state.right, false);
  bounceWalls(state.ball, true);

  damp(state.left, PLAYER_DAMPING, dt);
  damp(state.right, PLAYER_DAMPING, dt);
  damp(state.ball, BALL_DAMPING, dt);

  return state;
}
