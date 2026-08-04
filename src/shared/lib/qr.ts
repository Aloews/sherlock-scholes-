/**
 * A QR encoder, just big enough for an invite link.
 *
 * Scope is deliberate: byte mode, error-correction level M, versions 1–6
 * (up to 106 bytes). Our payload is the room deep link — around 49 bytes, so
 * version 4 — and every one of those versions has equal-sized error-correction
 * blocks and no version-information block, which keeps this file a few hundred
 * lines instead of a library. `encodeQr` throws on anything longer rather than
 * silently producing a code that will not scan.
 *
 * Correctness is not taken on faith: `qr.test.ts` renders the matrix to a
 * bitmap and decodes it with jsQR, so a wrong bit anywhere fails the suite.
 *
 * Reference: ISO/IEC 18004. Terminology below is that standard's.
 */

/** Highest version this encoder builds. Beyond it, blocks stop being uniform. */
const MAX_VERSION = 6;

interface VersionSpec {
  /** Total codewords in the symbol (data + error correction). */
  totalCodewords: number;
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** Number of blocks; every block holds the same number of data codewords. */
  blocks: number;
  /** Centre coordinates of the alignment patterns, finder corners included. */
  alignment: number[];
}

// Level M only. Data codewords per block = (total - ec * blocks) / blocks.
const VERSIONS: Record<number, VersionSpec> = {
  1: { totalCodewords: 26,  ecPerBlock: 10, blocks: 1, alignment: [] },
  2: { totalCodewords: 44,  ecPerBlock: 16, blocks: 1, alignment: [6, 18] },
  3: { totalCodewords: 70,  ecPerBlock: 26, blocks: 1, alignment: [6, 22] },
  4: { totalCodewords: 100, ecPerBlock: 18, blocks: 2, alignment: [6, 26] },
  5: { totalCodewords: 134, ecPerBlock: 24, blocks: 2, alignment: [6, 30] },
  6: { totalCodewords: 172, ecPerBlock: 16, blocks: 4, alignment: [6, 34] },
};

const dataCodewords = (v: VersionSpec): number =>
  v.totalCodewords - v.ecPerBlock * v.blocks;

/** Payload capacity in bytes: data codewords minus the 4-bit mode and 8-bit length. */
const byteCapacity = (v: VersionSpec): number => dataCodewords(v) - 2;

export interface QrMatrix {
  /** Side length in modules. */
  size: number;
  /** Row-major, `true` = dark. */
  modules: boolean[][];
}

// ─── GF(256) ────────────────────────────────────────────────────────────────
// The QR field: x^8 + x^4 + x^3 + x^2 + 1.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    // Multiply by (x + α^i). Index 0 is the highest-degree coefficient, so the
    // x term keeps its index and the α^i term moves one down; swapping these
    // two lines builds the polynomial back to front and every codeword is
    // wrong in a way that still looks like a QR code.
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder — the error-correction codewords for one block. */
function ecCodewords(data: number[], count: number): number[] {
  const gen = generatorPoly(count);
  const rem = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ─── Bit stream ─────────────────────────────────────────────────────────────

class Bits {
  private readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  get length(): number { return this.bits.length; }

  /** Pads to a whole number of codewords and returns them. */
  toCodewords(): number[] {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | this.bits[i + j];
      out.push(byte);
    }
    return out;
  }
}

/** Mode indicator + length + payload + terminator + the standard pad bytes. */
function buildCodewords(bytes: number[], spec: VersionSpec): number[] {
  const capacity = dataCodewords(spec);
  const bits = new Bits();
  bits.push(0b0100, 4);            // byte mode
  bits.push(bytes.length, 8);      // versions 1–9 use an 8-bit count
  for (const b of bytes) bits.push(b, 8);

  const terminator = Math.min(4, capacity * 8 - bits.length);
  bits.push(0, terminator);

  const codewords = bits.toCodewords();
  // 0xEC / 0x11 alternating is what the standard names; it is not arbitrary
  // filler, decoders rely on nothing else appearing here.
  for (let i = 0; codewords.length < capacity; i++) {
    codewords.push(i % 2 === 0 ? 0xec : 0x11);
  }
  return codewords;
}

/** Splits into blocks, appends error correction, and interleaves both. */
function interleave(codewords: number[], spec: VersionSpec): number[] {
  const perBlock = dataCodewords(spec) / spec.blocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let i = 0; i < spec.blocks; i++) {
    const block = codewords.slice(i * perBlock, (i + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const b of dataBlocks) out.push(b[i]);
  for (let i = 0; i < spec.ecPerBlock; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

// ─── Symbol layout ──────────────────────────────────────────────────────────

interface Canvas {
  size: number;
  modules: (boolean | null)[][];
  /** Function patterns and format areas — never carry data, never get masked. */
  reserved: boolean[][];
}

function blankCanvas(size: number): Canvas {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function set(c: Canvas, row: number, col: number, dark: boolean): void {
  c.modules[row][col] = dark;
  c.reserved[row][col] = true;
}

function drawFinder(c: Canvas, row: number, col: number): void {
  // The 7×7 eye plus its one-module separator, clipped at the symbol edge.
  for (let r = -1; r <= 7; r++) {
    for (let k = -1; k <= 7; k++) {
      const rr = row + r;
      const cc = col + k;
      if (rr < 0 || rr >= c.size || cc < 0 || cc >= c.size) continue;
      const ring = r >= 0 && r <= 6 && k >= 0 && k <= 6 &&
        (r === 0 || r === 6 || k === 0 || k === 6);
      const core = r >= 2 && r <= 4 && k >= 2 && k <= 4;
      set(c, rr, cc, ring || core);
    }
  }
}

function drawAlignment(c: Canvas, row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let k = -2; k <= 2; k++) {
      const edge = Math.abs(r) === 2 || Math.abs(k) === 2;
      set(c, row + r, col + k, edge || (r === 0 && k === 0));
    }
  }
}

function drawFunctionPatterns(c: Canvas, spec: VersionSpec, version: number): void {
  drawFinder(c, 0, 0);
  drawFinder(c, 0, c.size - 7);
  drawFinder(c, c.size - 7, 0);

  // Timing patterns: the alternating row and column at index 6.
  for (let i = 8; i < c.size - 8; i++) {
    set(c, 6, i, i % 2 === 0);
    set(c, i, 6, i % 2 === 0);
  }

  for (const r of spec.alignment) {
    for (const k of spec.alignment) {
      // The three corners already hold finders.
      const atFinder = (r === 6 && k === 6) ||
        (r === 6 && k === c.size - 7) || (r === c.size - 7 && k === 6);
      if (!atFinder) drawAlignment(c, r, k);
    }
  }

  // The dark module — always set, always here.
  set(c, 4 * version + 9, 8, true);

  // Reserve the two format-information strips; the bits go in after masking.
  for (let i = 0; i < 9; i++) {
    if (!c.reserved[8][i]) set(c, 8, i, false);
    if (!c.reserved[i][8]) set(c, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!c.reserved[8][c.size - 1 - i]) set(c, 8, c.size - 1 - i, false);
    if (!c.reserved[c.size - 1 - i][8]) set(c, c.size - 1 - i, 8, false);
  }
}

/** The zigzag: column pairs right to left, alternating direction, skipping column 6. */
function placeData(c: Canvas, codewords: number[]): void {
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;

  for (let right = c.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern is not a data column
    for (let step = 0; step < c.size; step++) {
      const row = upward ? c.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (c.reserved[row][col]) continue;
        const value = bit < total
          ? ((codewords[bit >> 3] >> (7 - (bit % 8))) & 1) === 1
          : false; // remainder bits are light
        c.modules[row][col] = value;
        bit++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(c: Canvas, mask: number): boolean[][] {
  const fn = MASKS[mask];
  return c.modules.map((row, r) => row.map((value, k) => {
    const dark = value === true;
    return c.reserved[r][k] ? dark : dark !== fn(r, k);
  }));
}

// ─── Mask penalties (ISO/IEC 18004 §8.8.2) ──────────────────────────────────

function penaltyRuns(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const scan = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  scan((a, b) => m[a][b]);
  scan((a, b) => m[b][a]);
  return score;
}

function penaltyBlocks(m: boolean[][]): number {
  let score = 0;
  for (let r = 0; r < m.length - 1; r++) {
    for (let c = 0; c < m.length - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  return score;
}

// The finder-lookalike: dark-light-dark-dark-dark-light-dark with four light
// modules on one side. A decoder hunting for finder patterns must not find it.
const FINDER_LIKE = [true, false, true, true, true, false, true];
const LIGHT_RUN = [false, false, false, false];

function matchesAt(line: boolean[], at: number, pattern: boolean[]): boolean {
  if (at < 0 || at + pattern.length > line.length) return false;
  return pattern.every((v, i) => line[at + i] === v);
}

function penaltyFinderLike(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let r = 0; r < size; r++) lines.push(m[r]);
  for (let c = 0; c < size; c++) lines.push(m.map((row) => row[c]));

  for (const line of lines) {
    for (let i = 0; i + FINDER_LIKE.length <= line.length; i++) {
      if (!matchesAt(line, i, FINDER_LIKE)) continue;
      const before = matchesAt(line, i - LIGHT_RUN.length, LIGHT_RUN);
      const after = matchesAt(line, i + FINDER_LIKE.length, LIGHT_RUN);
      if (before || after) score += 40;
    }
  }
  return score;
}

function penaltyBalance(m: boolean[][]): number {
  const total = m.length * m.length;
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / total;
  return Math.floor(Math.abs(percent - 50) / 5) * 10;
}

function penalty(m: boolean[][]): number {
  return penaltyRuns(m) + penaltyBlocks(m) + penaltyFinderLike(m) + penaltyBalance(m);
}

// ─── Format information ─────────────────────────────────────────────────────

/** 5 data bits (EC level + mask) extended by a BCH(15,5) code, then XOR-masked. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 0b00 = level M
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (i + 10)) & 1) rem ^= 0b10100110111 << i;
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function drawFormat(m: boolean[][], size: number, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;

  // Copy 1 — around the top-left finder, skipping the timing row and column.
  // It runs MOST significant bit first from (8,0); copy 2 below runs least
  // significant first from the bottom. Reading copy 1 backwards produces a
  // symbol that looks perfect and decodes as a different mask, i.e. as noise.
  for (let i = 0; i <= 5; i++) m[8][i] = bit(14 - i);
  m[8][7] = bit(8);
  m[8][8] = bit(7);
  m[7][8] = bit(6);
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);

  // Copy 2 — seven bits up the bottom-left finder, eight along the top-right.
  // The split is 7/8, not 8/7: (size-8, 8) is the dark module, and writing a
  // format bit over it is a code no scanner will read.
  for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) m[8][size - 15 + i] = bit(i);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Smallest version that fits `length` bytes, or null when nothing here does. */
export function versionFor(length: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (length <= byteCapacity(VERSIONS[v])) return v;
  }
  return null;
}

/**
 * Encodes `text` (ASCII/UTF-8 bytes) into a QR matrix, error-correction level M.
 *
 * Throws when the text does not fit versions 1–6 — the caller is asking for
 * something this encoder cannot honestly produce, and a truncated code is
 * worse than no code.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = versionFor(bytes.length);
  if (version === null) {
    throw new Error(`qr: ${bytes.length} bytes exceeds version ${MAX_VERSION}`);
  }

  const spec = VERSIONS[version];
  const size = 17 + 4 * version;
  const canvas = blankCanvas(size);
  drawFunctionPatterns(canvas, spec, version);
  placeData(canvas, interleave(buildCodewords(bytes, spec), spec));

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = applyMask(canvas, mask);
    drawFormat(candidate, size, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return { size, modules: best! };
}

/**
 * The matrix as one SVG path: every dark module a 1×1 rect, in module
 * coordinates. Drawing it as a single path rather than hundreds of elements
 * keeps the DOM small enough to re-render without thinking about it.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
}

