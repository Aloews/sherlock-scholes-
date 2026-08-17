// Протокол сетевой арены — чистые функции, без сокетов и без React.
//
// ПОЧЕМУ ОНЛАЙН ВООБЩЕ ВОЗМОЖЕН, ХОТЯ В КАРТЕ НАПИСАНО «НЕ БУДЕТ». Тот довод
// верен ровно для того, против чего он направлен: СИНХРОННАЯ физика, где оба
// телефона считают один шаг и ждут друг друга, требует обмена 60 раз в секунду
// при задержке в единицы миллисекунд, а замер этого проекта — 150–300 мс между
// континентами (docs/VIDEOCHAT_HANDOFF.md). Здесь схема другая и задержку
// терпит:
//
//   * шаг считает ТОЛЬКО хост — авторитет один, расхождению неоткуда взяться;
//   * гость шлёт хосту свой ввод, а не состояние;
//   * хост рассылает снимки ~20 раз в секунду, а не 60;
//   * гость рисует чужие тела С ЗАДЕРЖКОЙ в один интервал снимков и
//     интерполирует между двумя полученными — движение остаётся плавным,
//     хотя снимки редкие;
//   * свою ракетку гость двигает СРАЗУ, локально, и подтягивает к присланной
//     позиции постепенно. Поэтому «моё» управление ощущается мгновенным,
//     а «чужое» — плавным, и ни то ни другое не требует единиц миллисекунд.
//
// Цена честная: гость видит мяч на ~100–150 мс позже хоста. Для игры двумя
// кружками это незаметно, для шутера было бы неприемлемо.

import { PITCH_H, PITCH_W, type ArenaState, type PlayerInput, type Vec } from './physics';

/** Сколько снимков в секунду шлёт хост. */
export const SNAPSHOT_HZ = 20;
/** Сколько раз в секунду гость шлёт свой ввод. */
export const INPUT_HZ = 30;

/**
 * На сколько гость отстаёт от хоста при отрисовке.
 *
 * Ровно один интервал между снимками плюс небольшой запас: чтобы
 * интерполировать между двумя снимками, второй уже должен лежать в буфере.
 * Меньше — и гость упрётся в конец буфера и начнёт дёргаться на каждой
 * задержавшейся посылке; больше — и он просто смотрит в прошлое дольше, чем
 * нужно.
 */
export const INTERP_DELAY_MS = (1000 / SNAPSHOT_HZ) * 1.5;

/** Сколько снимков держим. Секунды с запасом хватает на любой всплеск. */
const BUFFER_LIMIT = SNAPSHOT_HZ * 2;

export type Side = 'left' | 'right';

/**
 * Снимок мира.
 *
 * Скорости НЕ передаются: гость их не интегрирует, он интерполирует между
 * двумя присланными положениями. Лишние шесть чисел в каждой посылке двадцать
 * раз в секунду — это трафик за данные, которыми никто не пользуется.
 */
export interface Snapshot {
  /** Время хоста, мс. Единственные часы, по которым сверяются обе стороны. */
  t: number;
  lx: number; ly: number;
  rx: number; ry: number;
  bx: number; by: number;
  sl: number; sr: number;
  /** Номер последнего ввода гостя, который хост успел учесть. */
  ack: number;
}

export interface InputMessage {
  /** Возрастающий номер: по нему хост отбрасывает опоздавшие посылки. */
  seq: number;
  mx: number;
  my: number;
  kick: boolean;
}

export function toSnapshot(state: ArenaState, t: number, ack: number): Snapshot {
  return {
    t,
    lx: round(state.left.x), ly: round(state.left.y),
    rx: round(state.right.x), ry: round(state.right.y),
    bx: round(state.ball.x), by: round(state.ball.y),
    sl: state.score.left, sr: state.score.right,
    ack,
  };
}

/** Десятая доля пикселя — предел, который вообще видно на поле 640×360. */
function round(v: number): number {
  return Math.round(v * 10) / 10;
}

export function toInputMessage(input: PlayerInput, seq: number): InputMessage {
  return {
    seq,
    mx: round(input.move.x),
    my: round(input.move.y),
    kick: input.kick,
  };
}

/**
 * Разбор пришедшего ввода.
 *
 * ⚠️ ЭТО НЕДОВЕРЕННЫЙ ВВОД, даже если он от «своего» игрока: в канал пишет
 * чужое устройство, и ничто не мешает ему прислать вектор длиной 100 и уехать
 * через всё поле за кадр. Длина зажимается здесь, до физики, потому что физика
 * — про правила игры, а не про защиту от подделки.
 */
export function readInputMessage(raw: unknown): InputMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.seq !== 'number' || !Number.isFinite(m.seq)) return null;
  const mx = num(m.mx);
  const my = num(m.my);
  return { seq: m.seq, mx, my, kick: m.kick === true };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Вектор движения из посылки, с зажатой длиной. */
export function clampMove(mx: number, my: number): Vec {
  const len = Math.hypot(mx, my);
  if (len <= 1 || len === 0) return { x: mx, y: my };
  return { x: mx / len, y: my / len };
}

export function readSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return null;
  return {
    t: m.t,
    lx: clampX(num(m.lx)), ly: clampY(num(m.ly)),
    rx: clampX(num(m.rx)), ry: clampY(num(m.ry)),
    bx: clampX(num(m.bx)), by: clampY(num(m.by)),
    sl: Math.max(0, Math.trunc(num(m.sl))),
    sr: Math.max(0, Math.trunc(num(m.sr))),
    ack: Math.max(0, Math.trunc(num(m.ack))),
  };
}

// Мяч заходит в ворота ЗА линию поля, поэтому запас по X шире, чем поле.
const clampX = (v: number) => Math.min(PITCH_W + 60, Math.max(-60, v));
const clampY = (v: number) => Math.min(PITCH_H + 60, Math.max(-60, v));

/**
 * Буфер снимков и отрисовка «в прошлом».
 *
 * Держит присланное упорядоченным по времени хоста и отдаёт положение на
 * момент `now - INTERP_DELAY_MS`, интерполируя между двумя соседними снимками.
 */
export class SnapshotBuffer {
  private items: Snapshot[] = [];
  /** Сдвиг между часами хоста и локальными. Оценивается по первому снимку. */
  private offset: number | null = null;

  push(snap: Snapshot, localNow: number): void {
    // Часы двух телефонов не совпадают, и разница бывает в минуты. Сверяться
    // надо не с абсолютным временем хоста, а со сдвигом; берётся он по первой
    // посылке и дальше подтягивается вниз — так оценка сходится к самой
    // быстрой доставке, а не к самой медленной.
    const candidate = localNow - snap.t;
    this.offset = this.offset === null ? candidate : Math.min(this.offset, candidate);

    // Повтор по времени хоста отбрасывается ДО вставки. Проверять «не равен
    // ли сосед справа» недостаточно: сосед справа по определению больше, а
    // равный стоит слева от него, и дубль проходил мимо такой проверки.
    if (this.items.some((s) => s.t === snap.t)) return;

    // Опоздавшая посылка вставляется на своё место, а не в конец: канал не
    // гарантирует порядок, а интерполяция по неупорядоченному буферу дала бы
    // рывок назад.
    const at = this.items.findIndex((s) => s.t > snap.t);
    if (at === -1) this.items.push(snap);
    else this.items.splice(at, 0, snap);

    if (this.items.length > BUFFER_LIMIT) this.items.splice(0, this.items.length - BUFFER_LIMIT);
  }

  get size(): number {
    return this.items.length;
  }

  get latest(): Snapshot | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  /**
   * Положения на момент отрисовки, или null — пока не пришло ни одного снимка.
   *
   * Возвращает `null` вместо «нулевого» состояния намеренно: нули — это левый
   * верхний угол поля, и один кадр с телами в углу читается как телепорт.
   */
  sample(localNow: number): Snapshot | null {
    if (this.items.length === 0 || this.offset === null) return null;
    const target = localNow - this.offset - INTERP_DELAY_MS;

    if (this.items.length === 1) return this.items[0];
    if (target <= this.items[0].t) return this.items[0];

    for (let i = this.items.length - 1; i > 0; i--) {
      const b = this.items[i];
      const a = this.items[i - 1];
      if (target >= a.t && target <= b.t) {
        const span = b.t - a.t;
        return lerpSnapshot(a, b, span === 0 ? 1 : (target - a.t) / span);
      }
    }
    // Отстали от буфера — показываем самое свежее. Это заметно как «догоняние»
    // и честнее, чем экстраполяция: выдуманное положение мяча приводит к тому,
    // что гол виден там, где его не было.
    return this.items[this.items.length - 1];
  }
}

export function lerpSnapshot(a: Snapshot, b: Snapshot, k: number): Snapshot {
  const t = Math.min(1, Math.max(0, k));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    t: mix(a.t, b.t),
    lx: mix(a.lx, b.lx), ly: mix(a.ly, b.ly),
    rx: mix(a.rx, b.rx), ry: mix(a.ry, b.ry),
    bx: mix(a.bx, b.bx), by: mix(a.by, b.by),
    // Счёт НЕ интерполируется: между 0 и 1 нет половины гола, и на кадре
    // перехода табло показало бы «0.4».
    sl: b.sl, sr: b.sr,
    ack: b.ack,
  };
}

/**
 * Подтягивание своей ракетки к присланной позиции.
 *
 * Гость двигает себя сам и потому всегда чуть впереди того, что знает хост.
 * Резко переставить его в присланную точку — это рывок на каждом снимке;
 * оставить как есть — это расхождение, которое копится, пока гость не начнёт
 * бить по мячу, которого перед ним нет.
 *
 * Поэтому: маленькое расхождение стягивается ПЛАВНО (доля пути за кадр), а
 * большое — сразу. Большое означает, что случилось событие, которого гость не
 * предсказывал: гол, розыгрыш с центра, столкновение. Догонять его плавно
 * значило бы ехать через всё поле на глазах у игрока.
 */
export const RECONCILE_SNAP_PX = 40;
export const RECONCILE_RATE = 0.2;

export function reconcile(local: Vec, authoritative: Vec): Vec {
  const dx = authoritative.x - local.x;
  const dy = authoritative.y - local.y;
  if (Math.hypot(dx, dy) > RECONCILE_SNAP_PX) return { ...authoritative };
  return { x: local.x + dx * RECONCILE_RATE, y: local.y + dy * RECONCILE_RATE };
}

/** Сторона, которой играет гость: хост всегда слева. */
export const HOST_SIDE: Side = 'left';
export const GUEST_SIDE: Side = 'right';

export function sideFor(isHost: boolean): Side {
  return isHost ? HOST_SIDE : GUEST_SIDE;
}
