import {
  PITCH_W, PITCH_H, GOAL_H, type ArenaState, type Body,
} from './physics';

/**
 * Отрисовка арены на canvas.
 *
 * ОТДЕЛЬНО ОТ ЦИКЛА И ОТ ФИЗИКИ, потому что это третья независимая вещь:
 * правила игры, ход времени и то, как всё выглядит. Физика считает в
 * логических координатах 640×360, экран бывает любой ширины, и перевод одного
 * в другое — единственное, что здесь происходит помимо самих фигур.
 *
 * ЦВЕТА ПРИХОДЯТ СНАРУЖИ. В компоненте нельзя писать hex, и то, что этот
 * компонент рисует, а не размечает, правила не отменяет: палитра читается из
 * CSS-переменных один раз при монтировании и передаётся сюда. Иначе арена
 * перестала бы переключаться вместе с дизайном — молча.
 */

/**
 * Глубина сетки за линией ворот.
 *
 * ХОЛСТ ШИРЕ ПОЛЯ на эту величину с каждой стороны, и это не украшение. Мяч
 * засчитывается, когда пересёк линию ЦЕЛИКОМ, — а на холсте ровно по размеру
 * поля он в этот момент уже за краем, и гол выглядит как исчезновение мяча.
 * Сетка — то место, где он должен быть виден лежащим.
 */
const NET_DEPTH = 22;
const VIEW_W = PITCH_W + NET_DEPTH * 2;

export interface Palette {
  turf: string;
  line: string;
  left: string;
  right: string;
  ball: string;
  bg: string;
}

const VAR = {
  turf: '--pitch-turf',
  line: '--pitch-line',
  left: '--team-left',
  right: '--team-right',
  ball: '--brand-highlight',
  bg: '--brand-bg',
} as const;

/**
 * Снять палитру с документа.
 *
 * Переменные хранятся тройками «R G B» без функции, чтобы Tailwind мог
 * подставлять их в rgb(... / alpha). Здесь та же тройка оборачивается вручную.
 */
export function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const read = (name: string, fallback: string) => {
    const raw = css.getPropertyValue(name).trim();
    return raw ? `rgb(${raw})` : fallback;
  };
  return {
    turf: read(VAR.turf, 'rgb(18 42 33)'),
    line: read(VAR.line, 'rgb(255 255 255)'),
    left: read(VAR.left, 'rgb(255 99 0)'),
    right: read(VAR.right, 'rgb(61 156 255)'),
    ball: read(VAR.ball, 'rgb(255 255 255)'),
    bg: read(VAR.bg, 'rgb(10 14 26)'),
  };
}

/** Тот же цвет с прозрачностью. Палитра — строки rgb(), поэтому разбором. */
function fade(color: string, alpha: number): string {
  const nums = color.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return color;
  return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
}

/** Пропорции холста — поле вместе с сетками. Экран задаёт им aspect-ratio. */
export const VIEW_ASPECT = VIEW_W / PITCH_H;

/**
 * Подогнать буфер canvas под его CSS-размер и плотность экрана.
 *
 * Без этого на телефоне с devicePixelRatio 3 всё размыто: canvas растягивает
 * свои пиксели на втрое большее число физических. Плотность ограничена
 * двойкой — третий проход по пикселям на арене не виден, а кадр стоит.
 *
 * Возвращает масштаб «логический пиксель → пиксель буфера», в котором дальше
 * и рисуется всё остальное.
 */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || VIEW_W;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round((w * PITCH_H) / VIEW_W));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return w / VIEW_W;
}

function disc(
  ctx: CanvasRenderingContext2D, b: Body, fill: string, ring: string, ringWidth: number,
): void {
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

export interface RenderOptions {
  /** Кто держит удар — вокруг игрока рисуется кольцо. */
  charging: { left: boolean; right: boolean };
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: ArenaState,
  palette: Palette,
  scale: number,
  options: RenderOptions,
): void {
  const canvas = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Дальше всё в логических координатах физики: начало отсчёта — угол ПОЛЯ, а
  // сетки уходят в отрицательный x. Так рисование говорит теми же числами,
  // что и симуляция, и ни одно место не пересчитывает координаты «на глаз».
  ctx.setTransform(scale, 0, 0, scale, NET_DEPTH * scale, 0);

  const mouthTop = (PITCH_H - GOAL_H) / 2;
  const mouthBottom = (PITCH_H + GOAL_H) / 2;

  // ─ Газон ─
  ctx.fillStyle = palette.turf;
  ctx.fillRect(0, 0, PITCH_W, PITCH_H);

  // ─ Сетки ─
  // Прямоугольник ЗА линией ворот. Мяч, доехавший до него, виден лежащим в
  // сетке — гол читается как гол, а не как пропавший мяч.
  const net = (x: number, color: string) => {
    ctx.fillStyle = fade(color, 0.16);
    ctx.fillRect(x, mouthTop, NET_DEPTH, GOAL_H);
    ctx.strokeStyle = fade(color, 0.4);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, mouthTop, NET_DEPTH, GOAL_H);
  };
  net(-NET_DEPTH, palette.left);
  net(PITCH_W, palette.right);

  // ─ Разметка ─
  ctx.strokeStyle = fade(palette.line, 0.18);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, PITCH_W - 2, PITCH_H - 2);

  ctx.beginPath();
  ctx.moveTo(PITCH_W / 2, 0);
  ctx.lineTo(PITCH_W / 2, PITCH_H);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(PITCH_W / 2, PITCH_H / 2, 52, 0, Math.PI * 2);
  ctx.stroke();

  // Вратарские — цветом команды, которая эти ворота ЗАЩИЩАЕТ: куда бежать,
  // должно быть видно на поле, а не только в надписи над ним.
  ctx.lineWidth = 2;
  ctx.strokeStyle = fade(palette.left, 0.35);
  ctx.strokeRect(0, mouthTop - 34, 62, GOAL_H + 68);
  ctx.strokeStyle = fade(palette.right, 0.35);
  ctx.strokeRect(PITCH_W - 62, mouthTop - 34, 62, GOAL_H + 68);

  // ─ Штанги ─
  // Линия ворот рисуется поверх разметки и толще неё: это единственный
  // участок границы, сквозь который мяч проходит.
  const post = (x: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, mouthTop);
    ctx.lineTo(x, mouthBottom);
    ctx.stroke();
  };
  post(2, palette.left);
  post(PITCH_W - 2, palette.right);

  // ─ Игроки ─
  const player = (b: Body, color: string, charging: boolean) => {
    if (charging) {
      // Кольцо заряда — единственная обратная связь по кнопке удара. Без неё
      // непонятно, промахнулся палец по кнопке или игрок по мячу.
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = fade(color, 0.55);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    disc(ctx, b, color, fade(palette.line, 0.9), 2.5);
  };
  player(state.left, palette.left, options.charging.left);
  player(state.right, palette.right, options.charging.right);

  // ─ Мяч ─
  disc(ctx, state.ball, palette.ball, fade(palette.bg, 0.85), 2.5);
}
