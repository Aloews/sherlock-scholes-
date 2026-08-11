import { describe, it, expect } from 'vitest';
import {
  PITCH_W, PITCH_H, GOAL_H, PLAYER_R, BALL_R,
  IDLE, kickoff, scored, step,
  type ArenaState, type Body, type Inputs, type PlayerInput,
} from './physics';

// Физику нельзя проверить глазами. В движении «мяч иногда прилипает к углу» и
// «мяч отскакивает правильно» выглядят одинаково — разница видна только в
// числах, и только если их сравнить с тем, чем они должны быть.
//
// Поэтому проверяется не «работает ли игра», а свойства, которые обязаны
// держаться на КАЖДОМ шаге: тела не остаются внутри друг друга, энергия не
// берётся из ниоткуда, мяч не покидает поле мимо створа, и один шаг в 0.1 с
// делает то же, что десять по 0.01 с.

const NOBODY: Inputs = { left: IDLE, right: IDLE };

/** Ввод одним выражением: джойстик и удар без построения объекта в тесте. */
function press(x: number, y: number, kick = false): PlayerInput {
  return { move: { x, y }, kick };
}

/**
 * Состояние с точной расстановкой.
 *
 * Игроки по умолчанию убраны в углы, а не оставлены на местах вбрасывания:
 * почти каждая проверка ниже — про одну пару тел, и третье, случайно
 * оказавшееся рядом, превратило бы падение теста в загадку.
 */
function arena(parts: {
  ball?: Partial<Body>;
  left?: Partial<Body>;
  right?: Partial<Body>;
}): ArenaState {
  const base = kickoff();
  return {
    left:  { ...base.left,  x: 40,           y: 40,           ...parts.left },
    right: { ...base.right, x: PITCH_W - 40, y: PITCH_H - 40, ...parts.right },
    ball:  { ...base.ball,  ...parts.ball },
    score: { left: 0, right: 0 },
  };
}

const speed = (b: Body) => Math.hypot(b.vx, b.vy);
const gap = (a: Body, b: Body) => Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r;
/** Импульс системы. Столкновение обязано его сохранять — в этом весь смысл. */
const momentum = (bodies: Body[]) => ({
  x: bodies.reduce((s, b) => s + b.m * b.vx, 0),
  y: bodies.reduce((s, b) => s + b.m * b.vy, 0),
});
const energy = (bodies: Body[]) =>
  bodies.reduce((s, b) => s + 0.5 * b.m * (b.vx ** 2 + b.vy ** 2), 0);

const finite = (state: ArenaState) => {
  for (const b of [state.left, state.right, state.ball]) {
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    expect(Number.isFinite(b.vx) && Number.isFinite(b.vy)).toBe(true);
  }
};

describe('kickoff', () => {
  it('ставит мяч в центр, а игроков — зеркально', () => {
    const s = kickoff();
    expect(s.ball.x).toBe(PITCH_W / 2);
    expect(s.ball.y).toBe(PITCH_H / 2);
    expect(s.left.y).toBe(s.right.y);
    expect(PITCH_W - s.right.x).toBeCloseTo(s.left.x, 6);
    expect(speed(s.ball)).toBe(0);
  });

  it('переносит счёт, потому что это ещё и расстановка после гола', () => {
    expect(kickoff({ left: 2, right: 1 }).score).toEqual({ left: 2, right: 1 });
  });

  it('копирует счёт, а не берёт ссылку на него', () => {
    const score = { left: 1, right: 0 };
    const s = kickoff(score);
    s.score.left = 9;
    expect(score.left).toBe(1);
  });

  it('никто не стоит внутри другого', () => {
    const s = kickoff();
    expect(gap(s.left, s.ball)).toBeGreaterThan(0);
    expect(gap(s.right, s.ball)).toBeGreaterThan(0);
    expect(gap(s.left, s.right)).toBeGreaterThan(0);
  });
});

describe('step не трогает прошлое состояние', () => {
  // Экран держит состояние в ref и перерисовывает по нему. Если шаг правил бы
  // аргумент, «предыдущий кадр» перестал бы существовать, и любая попытка
  // сгладить движение между кадрами показывала бы одно и то же.
  it('возвращает новое состояние, а старое оставляет как было', () => {
    const before = arena({ ball: { vx: 100, vy: 50 } });
    const snapshot = JSON.parse(JSON.stringify(before));
    const after = step(before, NOBODY, 1 / 60);
    expect(before).toEqual(snapshot);
    expect(after).not.toBe(before);
    expect(after.ball).not.toBe(before.ball);
  });

  it('не портит общий IDLE, который передаётся каждый кадр', () => {
    let s = kickoff();
    for (let i = 0; i < 30; i++) s = step(s, NOBODY, 1 / 60);
    expect(IDLE).toEqual({ move: { x: 0, y: 0 }, kick: false });
  });
});

describe('столкновение', () => {
  // Мяч летит в стоящего игрока по прямой: единственная пара, у которой
  // ответ можно назвать заранее.
  const headOn = () => arena({
    left: { x: 300, y: PITCH_H / 2 },
    ball: { x: 300 - PLAYER_R - BALL_R - 1, y: PITCH_H / 2, vx: 200 },
  });

  it('сохраняет импульс: сколько один потерял, столько другой получил', () => {
    const before = headOn();
    const after = step(before, NOBODY, 1 / 600);
    // Затухание за 1/600 секунды у игрока и мяча разное, поэтому импульс
    // сравнивается ДО него — иначе проверялось бы трение, а не удар. Здесь
    // это видно как небольшой допуск, а не как отдельная арифметика.
    const p0 = momentum([before.left, before.ball]);
    const p1 = momentum([after.left, after.ball]);
    expect(p1.x).toBeCloseTo(p0.x, 0);
    expect(p1.y).toBeCloseTo(p0.y, 3);
  });

  it('не выдумывает энергию', () => {
    const before = headOn();
    const after = step(before, NOBODY, 1 / 600);
    expect(energy([after.left, after.ball])).toBeLessThanOrEqual(
      energy([before.left, before.ball]) + 1e-9,
    );
  });

  it('разводит тела, а не оставляет их внутри друг друга', () => {
    // Вот эта проверка и есть «мяч не залипает». Наивная физика меняет
    // скорости и забывает про положения, а следующий кадр видит то же
    // пересечение, отрабатывает его ещё раз — и тела дрожат на месте.
    const after = step(headOn(), NOBODY, 1 / 60);
    expect(gap(after.left, after.ball)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('двигает лёгкий мяч сильнее тяжёлого игрока', () => {
    const before = headOn();
    const after = step(before, NOBODY, 1 / 600);
    expect(speed(after.ball)).toBeGreaterThan(speed(after.left));
  });

  it('не добавляет импульс телам, которые уже расходятся', () => {
    // Пересекаются, но мяч летит ПРОЧЬ. Второе срабатывание столкновения
    // здесь разогнало бы его ещё раз — из ничего.
    //
    // Сравнение с контрольным прогоном, а не с формулой затухания: считать
    // ожидаемую скорость руками значит переписать константу физики в тест, и
    // тогда её правка ломает проверку, которая про совсем другое. Так уже
    // вышло один раз.
    const parting = (ballX: number) => arena({
      left: { x: 300, y: PITCH_H / 2 },
      ball: { x: ballX, y: PITCH_H / 2, vx: 150 },
    });
    const touching = step(parting(300 + PLAYER_R + BALL_R - 4), NOBODY, 1 / 600);
    const apart = step(parting(500), NOBODY, 1 / 600);

    expect(touching.ball.vx).toBeCloseTo(apart.ball.vx, 9);
    // Разводить их всё равно надо: положение правится, скорость — нет.
    expect(gap(touching.left, touching.ball)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('не превращает поле в NaN, когда центры совпали', () => {
    // Так бывает после гола, если расстановка и мяч оказались в одной точке:
    // направление отталкивания не определено, и деление на ноль стоило бы
    // всей симуляции, а не одного кадра.
    const after = step(
      arena({ left: { x: 200, y: 200 }, ball: { x: 200, y: 200 } }),
      NOBODY, 1 / 60,
    );
    finite(after);
    expect(gap(after.left, after.ball)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('расходится из полной кучи, а не дрожит в ней', () => {
    // Три тела в одной точке — худший вход, который вообще возможен.
    let s = arena({
      left:  { x: 320, y: 180 },
      right: { x: 320, y: 180 },
      ball:  { x: 320, y: 180 },
    });
    for (let i = 0; i < 120; i++) s = step(s, NOBODY, 1 / 60);
    finite(s);
    expect(gap(s.left, s.right)).toBeGreaterThanOrEqual(-1e-6);
    expect(gap(s.left, s.ball)).toBeGreaterThanOrEqual(-1e-6);
    expect(gap(s.right, s.ball)).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('удар', () => {
  const touching = () => arena({
    left: { x: 300, y: PITCH_H / 2 },
    ball: { x: 300 + PLAYER_R + BALL_R - 2, y: PITCH_H / 2 },
  });

  it('разгоняет мяч от игрока', () => {
    const kicked = step(touching(), { left: press(0, 0, true), right: IDLE }, 1 / 60);
    const not = step(touching(), NOBODY, 1 / 60);
    expect(kicked.ball.vx).toBeGreaterThan(not.ball.vx);
    expect(kicked.ball.vx).toBeGreaterThan(100);
  });

  it('не достаёт до мяча, до которого не достаёт игрок', () => {
    // Намеренно: удар на расстоянии превращает футбол в стрельбу.
    const far = arena({ left: { x: 300, y: PITCH_H / 2 }, ball: { x: 420, y: PITCH_H / 2 } });
    const after = step(far, { left: press(0, 0, true), right: IDLE }, 1 / 60);
    expect(speed(after.ball)).toBe(0);
  });

  it('бьёт по направлению от игрока к мячу, а не по джойстику', () => {
    const above = arena({
      left: { x: 300, y: 200 },
      ball: { x: 300, y: 200 - PLAYER_R - BALL_R + 2 },
    });
    // Джойстик смотрит вправо, мяч — сверху. Улететь он должен вверх.
    const after = step(above, { left: press(1, 0, true), right: IDLE }, 1 / 60);
    expect(after.ball.vy).toBeLessThan(-100);
    expect(Math.abs(after.ball.vx)).toBeLessThan(Math.abs(after.ball.vy));
  });
});

describe('движение игрока', () => {
  // Бегущему игроку нужна пустая дорожка. `arena` оставляет мяч в центре, и
  // первая версия этих проверок гоняла игрока прямо СКВОЗЬ него: числа
  // расходились, и это выглядело как сломанное ускорение, а не как попавшийся
  // по дороге мяч. Отсюда `PARKED` — мяч убран к верхней стене.
  const PARKED = { x: 320, y: 40 };

  it('по диагонали не быстрее, чем по прямой', () => {
    // Иначе бегать наискосок выгоднее, и вся игра играется по диагонали.
    // Старт в углу: на диагонали игрок иначе успевает дойти до нижней стены,
    // и сравнивались бы отскоки, а не скорости.
    let straight = arena({ left: { x: 60, y: 60 }, ball: PARKED });
    let diagonal = arena({ left: { x: 60, y: 60 }, ball: PARKED });
    for (let i = 0; i < 60; i++) {
      straight = step(straight, { left: press(1, 0), right: IDLE }, 1 / 60);
      diagonal = step(diagonal, { left: press(1, 1), right: IDLE }, 1 / 60);
    }
    expect(speed(diagonal.left)).toBeCloseTo(speed(straight.left), 3);
  });

  it('держит потолок скорости, сколько ни держи джойстик', () => {
    let s = arena({ left: { x: 60, y: 180 }, ball: PARKED });
    for (let i = 0; i < 600; i++) {
      s = step(s, { left: press(1, 0), right: IDLE }, 1 / 60);
      expect(speed(s.left)).toBeLessThanOrEqual(261);
    }
  });

  it('останавливается меньше чем за секунду, когда палец отпустили', () => {
    // ЧИСЛО ЗДЕСЬ — ЭТО ОЩУЩЕНИЕ ОТ УПРАВЛЕНИЯ, а не формальность. Первые
    // константы затухания были покадровыми, применёнными к секунде, и
    // отпущенный игрок катился 27 секунд, отскакивая от стен. Проверка
    // существует, чтобы это не вернулось незамеченным.
    let s = arena({ left: { x: 300, y: 180, vx: 260 }, ball: PARKED });
    for (let i = 0; i < 60; i++) s = step(s, NOBODY, 1 / 60);
    expect(speed(s.left)).toBeLessThan(26); // меньше 10% от скорости бега
  });

  it('слушает наклон джойстика, а не только его направление', () => {
    const at = () => arena({ left: { x: 300, y: 180 }, ball: PARKED });
    const soft = step(at(), { left: press(0.25, 0), right: IDLE }, 1 / 60);
    const hard = step(at(), { left: press(1, 0), right: IDLE }, 1 / 60);
    expect(soft.left.vx).toBeGreaterThan(0);
    expect(soft.left.vx).toBeLessThan(hard.left.vx);
  });

  it('мяч катится дольше игрока — это и есть разница между футболом и шайбами', () => {
    let s = arena({ left: { x: 300, y: 90, vx: 200 }, ball: { x: 300, y: 270, vx: 200 } });
    for (let i = 0; i < 60; i++) s = step(s, NOBODY, 1 / 60);
    expect(speed(s.ball)).toBeGreaterThan(speed(s.left));
  });
});

describe('стены и створ', () => {
  it('мяч не покидает поле мимо ворот', () => {
    // Прогон по случайным начальным скоростям: любая одна расстановка
    // проверяет одну траекторию, а нужно свойство.
    let seed = 20260811;
    const rnd = () => {
      // Детерминированный генератор: падение теста должно повторяться.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let run = 0; run < 40; run++) {
      let s = arena({
        ball: { x: PITCH_W / 2, y: PITCH_H / 2, vx: (rnd() - 0.5) * 900, vy: (rnd() - 0.5) * 900 },
      });
      for (let i = 0; i < 240; i++) {
        s = step(s, NOBODY, 1 / 60);
        finite(s);
        if (scored(s)) break;
        // По вертикали мяч не уходит никогда: ворота — дыра в боковой стене.
        expect(s.ball.y).toBeGreaterThanOrEqual(BALL_R - 1e-6);
        expect(s.ball.y).toBeLessThanOrEqual(PITCH_H - BALL_R + 1e-6);
        // По горизонтали — только через створ, и тогда центр мяча в его высоте.
        if (s.ball.x < BALL_R - 1e-6 || s.ball.x > PITCH_W - BALL_R + 1e-6) {
          expect(Math.abs(s.ball.y - PITCH_H / 2)).toBeLessThan(GOAL_H / 2);
        }
      }
    }
  });

  it('игрок не уходит с поля даже через створ', () => {
    let s = arena({ left: { x: 100, y: PITCH_H / 2 } });
    for (let i = 0; i < 600; i++) s = step(s, { left: press(-1, 0), right: IDLE }, 1 / 60);
    expect(s.left.x).toBeGreaterThanOrEqual(PLAYER_R - 1e-6);
  });

  it('от стены отскакивает, а не залипает в ней', () => {
    let s = arena({ ball: { x: PITCH_W / 2, y: 30, vy: -300 } });
    for (let i = 0; i < 12; i++) s = step(s, NOBODY, 1 / 60);
    expect(s.ball.vy).toBeGreaterThan(0);
    expect(s.ball.y).toBeGreaterThanOrEqual(BALL_R - 1e-6);
  });

  it('отскок гасит скорость, а не усиливает её', () => {
    const before = arena({ ball: { x: PITCH_W / 2, y: BALL_R + 1, vy: -300 } });
    const after = step(before, NOBODY, 1 / 60);
    expect(Math.abs(after.ball.vy)).toBeLessThan(Math.abs(before.ball.vy));
  });
});

describe('scored', () => {
  const withBall = (x: number, y = PITCH_H / 2) => arena({ ball: { x, y } });

  it('молчит, пока мяч на поле', () => {
    expect(scored(kickoff())).toBeNull();
    expect(scored(withBall(BALL_R))).toBeNull();
    expect(scored(withBall(PITCH_W - BALL_R))).toBeNull();
  });

  it('ждёт, пока мяч пересечёт линию ЦЕЛИКОМ', () => {
    // Мяч ровно на линии: ещё не гол. Иначе гол засчитывается в момент, когда
    // мяч видимо в поле, и это читается как ошибка, а не как правило.
    expect(scored(withBall(0))).toBeNull();
    expect(scored(withBall(-BALL_R))).toBeNull();
    expect(scored(withBall(-BALL_R - 0.01))).toBe('right');

    expect(scored(withBall(PITCH_W))).toBeNull();
    expect(scored(withBall(PITCH_W + BALL_R))).toBeNull();
    expect(scored(withBall(PITCH_W + BALL_R + 0.01))).toBe('left');
  });

  it('засчитывает гол в левые ворота правому — они названы по стороне поля', () => {
    expect(scored(withBall(-100))).toBe('right');
    expect(scored(withBall(PITCH_W + 100))).toBe('left');
  });

  it('доводит мяч, пущенный в створ, до гола', () => {
    let s = arena({ ball: { x: 200, y: PITCH_H / 2, vx: -400 } });
    let goal: 'left' | 'right' | null = null;
    for (let i = 0; i < 120 && !goal; i++) {
      s = step(s, NOBODY, 1 / 60);
      goal = scored(s);
    }
    expect(goal).toBe('right');
  });

  it('не даёт гола мячу, пущенному в стену рядом со створом', () => {
    let s = arena({ ball: { x: 200, y: BALL_R + 2, vx: -400 } });
    for (let i = 0; i < 120; i++) {
      s = step(s, NOBODY, 1 / 60);
      expect(scored(s)).toBeNull();
    }
  });
});

describe('шаг не зависит от частоты кадров', () => {
  // Иначе на телефоне со 120 Гц мяч останавливается вдвое быстрее, чем на
  // 60 Гц, и одна и та же игра играется по-разному на двух телефонах.
  it('затухание за 0.1 с одинаково одним шагом и десятью', () => {
    const start = arena({ ball: { x: 320, y: 180, vx: 300, vy: -120 } });

    const once = step(start, NOBODY, 0.1);
    let many = start;
    for (let i = 0; i < 10; i++) many = step(many, NOBODY, 0.01);

    expect(many.ball.vx).toBeCloseTo(once.ball.vx, 6);
    expect(many.ball.vy).toBeCloseTo(once.ball.vy, 6);
  });

  it('игрок пробегает за секунду одно и то же расстояние при любой частоте', () => {
    // Проверяется ПУТЬ, а не скорость, и это не придирка. Скорость читается
    // сразу после затухания, а его величина за кадр зависит от длины кадра:
    // 249.6 при 60 Гц против 254.7 при 120 Гц — расхождение, которого игрок
    // не видит. Видит он, куда добежал: 293.9 против 292.5 за ту же секунду.
    //
    // Разница в 1.4 пикселя набирается на первых кадрах разгона и дальше не
    // растёт — на второй секунде это уже 0.29%. Ошибка ограничена, а не
    // накапливается, и именно это здесь и утверждается.
    const run = (dt: number, seconds: number) => {
      // Мяч убран с дороги: иначе сравнивались бы два столкновения с ним,
      // случившиеся на разных кадрах, а не разгон.
      let s = arena({ left: { x: 60, y: 180 }, ball: { x: 320, y: 40 } });
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        s = step(s, { left: press(1, 0), right: IDLE }, dt);
      }
      return s.left.x - 60;
    };
    const fast = run(1 / 120, 1);
    const normal = run(1 / 60, 1);
    const slow = run(1 / 30, 1);
    expect(Math.abs(fast - normal) / normal).toBeLessThan(0.01);
    expect(Math.abs(fast - slow) / slow).toBeLessThan(0.02);
    // И расхождение не копится: за две секунды оно относительно МЕНЬШЕ.
    expect(Math.abs(run(1 / 120, 2) - run(1 / 60, 2)) / run(1 / 60, 2))
      .toBeLessThan(Math.abs(fast - normal) / normal);
  });
});

describe('зеркальность', () => {
  it('одинаковая расстановка слева и справа даёт одинаковый результат', () => {
    // Поле симметрично, поэтому и физика обязана быть: перевес одной стороны
    // не заметен в игре, но делает её нечестной.
    const straight = step(
      arena({
        left: { x: 300, y: 180 },
        right: { x: 20, y: 20 },
        ball: { x: 300 + PLAYER_R + BALL_R - 2, y: 180 },
      }),
      { left: press(1, 0, true), right: IDLE }, 1 / 60,
    );
    const mirrored = step(
      arena({
        right: { x: PITCH_W - 300, y: 180 },
        left: { x: PITCH_W - 20, y: 20 },
        ball: { x: PITCH_W - (300 + PLAYER_R + BALL_R - 2), y: 180 },
      }),
      { left: IDLE, right: press(-1, 0, true) }, 1 / 60,
    );
    expect(mirrored.ball.vx).toBeCloseTo(-straight.ball.vx, 6);
    expect(mirrored.ball.vy).toBeCloseTo(straight.ball.vy, 6);
  });
});
