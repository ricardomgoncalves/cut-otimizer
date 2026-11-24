// A QR code encoder (ISO/IEC 18004): text -> module grid, for the page model's `qr` item. Byte mode
// (UTF-8), the smallest version (1–40) that fits at the chosen error correction level, the mask with the
// lowest penalty. No quiet zone: the caller leaves that white space around the code.

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

/** Format-info bits of each level. */
const ECC_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Per level, indexed by version (index 0 unused): error correction codewords per block, and block count.
const ECC_PER_BLOCK: Record<QrEcc, readonly number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<QrEcc, readonly number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const size = (version: number) => version * 4 + 17;

/** Modules that carry data (codewords + remainder bits) in a version. */
function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

const tableAt = (t: readonly number[], v: number) => t[v] ?? 0;

function dataCodewords(version: number, ecc: QrEcc): number {
  return Math.floor(rawDataModules(version) / 8) - tableAt(ECC_PER_BLOCK[ecc], version) * tableAt(BLOCKS[ecc], version);
}

/** Centres of the alignment patterns along one axis. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size(version) - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

// --- Reed-Solomon over GF(256), polynomial 0x11D ---------------------------------------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((d, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(d, factor);
    });
  }
  return result;
}

/** Splits the data into blocks, adds each block's error correction and interleaves them. */
function withErrorCorrection(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const blockCount = tableAt(BLOCKS[ecc], version);
  const eccLen = tableAt(ECC_PER_BLOCK[ecc], version);
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (raw % blockCount);
  const shortLen = Math.floor(raw / blockCount);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < blockCount; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const block = [...dat];
    if (i < shortBlocks) block.push(0); // padding so every block has the same length while interleaving
    block.push(...rsRemainder(dat, divisor));
    blocks.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < shortLen + 1; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i] ?? 0);
    });
  }
  return out;
}

// --- Data bits ------------------------------------------------------------------------------------

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function dataBits(bytes: readonly number[], version: number, ecc: QrEcc): number[] | null {
  const capacity = dataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  if (bits.length > capacity) return null;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return codewords;
}

// --- The matrix -----------------------------------------------------------------------------------

class Matrix {
  readonly n: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(n: number) {
    this.n = n;
    this.dark = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    this.fixed = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  }

  set(x: number, y: number, dark: boolean): void {
    const row = this.dark[y];
    const fixedRow = this.fixed[y];
    if (!row || !fixedRow) return;
    row[x] = dark;
    fixedRow[x] = true;
  }

  get(x: number, y: number): boolean {
    return this.dark[y]?.[x] ?? false;
  }

  isFixed(x: number, y: number): boolean {
    return this.fixed[y]?.[x] ?? false;
  }
}

function drawPatterns(m: Matrix, version: number): void {
  const n = m.n;
  for (let i = 0; i < n; i++) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) m.set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(n - 4, 3);
  finder(3, n - 4);
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((ax, i) => {
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) m.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  drawFormat(m, 0, 'M'); // reserve; redrawn with the real mask
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.set(a, b, bit);
      m.set(b, a, bit);
    }
  }
}

function drawFormat(m: Matrix, mask: number, ecc: QrEcc): void {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const n = m.n;
  for (let i = 0; i <= 5; i++) m.set(8, i, bit(i));
  m.set(8, 7, bit(6));
  m.set(8, 8, bit(7));
  m.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.set(8, n - 15 + i, bit(i));
  m.set(8, n - 8, true); // the dark module
}

function drawCodewords(m: Matrix, codewords: readonly number[]): void {
  const n = m.n;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (m.isFixed(x, y)) continue;
        const row = m.dark[y];
        if (row && i < codewords.length * 8) row[x] = (((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number): void {
  const f = MASKS[mask];
  if (!f) return;
  for (let y = 0; y < m.n; y++) {
    const row = m.dark[y];
    if (!row) continue;
    for (let x = 0; x < m.n; x++) if (!m.isFixed(x, y) && f(x, y)) row[x] = !row[x];
  }
}

/** The standard penalty score (lower is easier to read). */
function penalty(grid: boolean[][]): number {
  const n = grid.length;
  const at = (x: number, y: number) => grid[y]?.[x] ?? false;
  let score = 0;
  const lines = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      // Finder-like 1:1:3:1:1 runs with 4 light modules on either side.
      for (let j = 0; j + 7 <= n; j++) {
        const core = [true, false, true, true, true, false, true].every((v, k) => get(i, j + k) === v);
        if (!core) continue;
        const lightBefore = [1, 2, 3, 4].every((k) => j - k < 0 || !get(i, j - k));
        const lightAfter = [0, 1, 2, 3].every((k) => j + 7 + k >= n || !get(i, j + 7 + k));
        if (lightBefore || lightAfter) score += 40;
      }
    }
  };
  lines((i, j) => at(j, i));
  lines((i, j) => at(i, j));
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (at(x, y)) dark++;
      if (x + 1 < n && y + 1 < n) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
      }
    }
  }
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * The QR code of `text`: `modules[row][col]`, true = dark, without a quiet zone. Throws when the text
 * doesn't fit a version 40 code at this level.
 */
export function qrCode(text: string, ecc: QrEcc): boolean[][] {
  const bytes = utf8(text);
  for (let version = 1; version <= 40; version++) {
    const data = dataBits(bytes, version, ecc);
    if (!data) continue;
    const codewords = withErrorCorrection(data, version, ecc);
    let best: { grid: boolean[][]; score: number } | null = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = new Matrix(size(version));
      drawPatterns(m, version);
      drawCodewords(m, codewords);
      applyMask(m, mask);
      drawFormat(m, mask, ecc);
      const score = penalty(m.dark);
      if (!best || score < best.score) best = { grid: m.dark, score };
    }
    if (best) return best.grid;
  }
  throw new Error(`Too long for a QR code: ${String(bytes.length)} bytes`);
}
