// Part labels (PRD stories 8.1–8.3): one sticker per Part on L7163 sheets (2 × 7 labels of 99.1 × 38.1 mm),
// in Run order, stuck on the Part's `bottom` face (the face that ends up hidden). Each label draws that face
// as seen with the label up, says what the Part is, carries the QR code Scan mode reads, and a Step tick row.
import type { CncOp, Model, Part, PartEdge } from '../model.ts';
import type { Plan } from '../planner/index.ts';
import { scanPayload, steps, type Step } from '../progress.ts';
import { mmText } from './format.ts';
import { GREY, WHITE, fitSize, text, tickBox } from './layout.ts';
import { A4, BLACK, type Item, type Page } from './page.ts';
import { qrCode, type QrEcc } from './qr.ts';
import { printable, textWidth, wrapText } from './text.ts';

/** The sticker: one L7163 label, mm. */
export const LABEL = { width: 99.1, height: 38.1 } as const;

/** The L7163 sheet: 2 × 7 labels, mm. */
const SHEET = { columns: 2, rows: 7, top: 15.15, left: 4.65, columnGap: 2.5 } as const;

/**
 * The label's QR code: `size` mm square including the quiet zone of `quiet` modules, at error correction
 * `ecc`. The text is scanPayload(short id, Part id). Change them here: the labels and the size ladder read them.
 */
export const LABEL_QR: { size: number; ecc: QrEcc; quiet: number } = { size: 14, ecc: 'M', quiet: 2 };

/** What the labels need besides the Plan. */
export interface LabelsJob {
  /** The Job name. */
  name: string;
  shortId: string;
  model: Model;
}

/** Sticker spot rules, µm: how far from the Part's edges, and how much clearance around every op. */
const SPOT_EDGE = 15_000;
const SPOT_CLEARANCE = 3_000;

/**
 * Where the sticker goes on the Part's bottom face, in the Part's cut frame (µm, seen from the top like
 * `Part.bottom`): `length` along the Part's X, `width` along its Y; `rotated` when the sticker's long side runs
 * along the Part's Y.
 */
export interface StickerSpot {
  x: number;
  y: number;
  length: number;
  width: number;
  rotated: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const isThrough = (op: CncOp, thickness: number) => op.depth === 'through' || op.depth >= thickness;

/** The ops seen on the bottom face: its own ops plus the through ops from the top. */
export function bottomFaceOps(part: Part): { op: CncOp; own: boolean }[] {
  return [
    ...part.bottom.map((op) => ({ op, own: true })),
    ...part.top.filter((op) => isThrough(op, part.thickness)).map((op) => ({ op, own: false })),
  ];
}

function opRect(op: CncOp): Rect {
  switch (op.kind) {
    case 'drill': {
      const r = op.diameter / 2;
      return { x0: op.at.x - r, y0: op.at.y - r, x1: op.at.x + r, y1: op.at.y + r };
    }
    case 'groove': {
      const h = op.width / 2;
      return {
        x0: Math.min(op.from.x, op.to.x) - h,
        y0: Math.min(op.from.y, op.to.y) - h,
        x1: Math.max(op.from.x, op.to.x) + h,
        y1: Math.max(op.from.y, op.to.y) + h,
      };
    }
    case 'pocket':
      return {
        x0: op.centre.x - op.length / 2,
        y0: op.centre.y - op.width / 2,
        x1: op.centre.x + op.length / 2,
        y1: op.centre.y + op.width / 2,
      };
  }
}

/**
 * The sticker spot: SPOT_EDGE from the edges, SPOT_CLEARANCE clear of every op on the bottom face (through
 * holes included), as near the middle of the face as fits. Lengthwise when that fits anywhere, else turned.
 * Null when it fits nowhere.
 */
export function stickerSpot(part: Part): StickerSpot | null {
  const blocked = bottomFaceOps(part).map(({ op }) => {
    const r = opRect(op);
    return { x0: r.x0 - SPOT_CLEARANCE, y0: r.y0 - SPOT_CLEARANCE, x1: r.x1 + SPOT_CLEARANCE, y1: r.y1 + SPOT_CLEARANCE };
  });
  const long = Math.round(LABEL.width * 1000);
  const short = Math.round(LABEL.height * 1000);
  for (const rotated of [false, true]) {
    const length = rotated ? short : long;
    const width = rotated ? long : short;
    const best = nearestClear(part.cutLength, part.cutWidth, length, width, blocked);
    if (best) return { ...best, length, width, rotated };
  }
  return null;
}

/**
 * The clear position of a `length` × `width` rectangle nearest the middle of the face. The nearest point of any
 * free area to the middle lies, on each axis, at the centred position or against an edge of an obstacle or of
 * the allowed area, so only those positions are tried.
 */
function nearestClear(
  faceLength: number,
  faceWidth: number,
  length: number,
  width: number,
  blocked: Rect[],
): { x: number; y: number } | null {
  const xMax = faceLength - SPOT_EDGE - length;
  const yMax = faceWidth - SPOT_EDGE - width;
  if (xMax < SPOT_EDGE || yMax < SPOT_EDGE) return null;
  const cx = (faceLength - length) / 2;
  const cy = (faceWidth - width) / 2;
  const candidates = (centre: number, min: number, max: number, edges: number[]) =>
    [centre, min, max, ...edges].filter((v) => v >= min && v <= max);
  const xs = candidates(cx, SPOT_EDGE, xMax, blocked.flatMap((r) => [r.x0 - length, r.x1]));
  const ys = candidates(cy, SPOT_EDGE, yMax, blocked.flatMap((r) => [r.y0 - width, r.y1]));
  let best: { x: number; y: number; d: number } | null = null;
  for (const x of xs) {
    for (const y of ys) {
      if (blocked.some((r) => x < r.x1 && r.x0 < x + length && y < r.y1 && r.y0 < y + width)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d - 1e-6) best = { x, y, d };
    }
  }
  return best && { x: best.x, y: best.y };
}

// --- Label sheets ---------------------------------------------------------------------------------

const PT = 25.4 / 72;
const SIZE = {
  owner: 15 * PT,
  ownerMin: 7 * PT,
  part: 9.5 * PT,
  partMin: 7 * PT,
  cabinet: 7 * PT,
  finished: 8 * PT,
  pill: 6 * PT,
  note: 5.2 * PT,
  where: 4.8 * PT,
  edge: 1.9,
  tick: 6.5 * PT,
} as const;
const INSET = { x: 2.5, top: 1.4 } as const;
const DRAWING = { x: INSET.x, y: INSET.top, width: 42, height: 26.5, pad: 3.2 } as const;
const RIGHT = INSET.x + DRAWING.width + 2;
const QR_X = LABEL.width - INSET.x - LABEL_QR.size;
const TEXT_WIDTH = QR_X - 1.5 - RIGHT;
const RULE_Y = 32.2;
const FLIP_FILL = '#e6e6e6';
const SPOT_FILL = '#c8c8c8';
const OP_FILL = '#999999';
const OFF = '#bbbbbb';

const STEP_NAMES: Record<Step, string> = { cut: 'Cut', sideB: 'Side B', banded: 'Banded', manualOps: 'Manual ops' };
const STEP_ORDER: Step[] = ['cut', 'sideB', 'banded', 'manualOps'];

/** One label's Part and where it is cut, in label order. */
export interface LabelEntry {
  partId: string;
  /** "W18-1-A #2", "Saw · W18 Board 1", "Saw · too big for a Board". */
  where: string;
}

/**
 * The label order: Saw Parts first (Sheets in Run order, Board by Board in saw cut order, then the Saw Parts
 * too big for any Board), then every Blank's Parts by `#n` (Blanks in Run order).
 */
export function labelOrder(plan: Plan): LabelEntry[] {
  const saw: LabelEntry[] = [];
  const cnc: LabelEntry[] = [];
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) {
      for (const p of board.sawParts) saw.push({ partId: p.partId, where: `Saw · ${sheet.code} Board ${String(board.number)}` });
      for (const blank of board.blanks) {
        for (const p of [...blank.parts].sort((a, b) => a.n - b.n)) cnc.push({ partId: p.partId, where: `${blank.id} #${String(p.n)}` });
      }
    }
    for (const id of sheet.unplaced) saw.push({ partId: id, where: 'Saw · too big for a Board' });
  }
  return [...saw, ...cnc];
}

/** The label sheets: 14 labels a sheet in label order (labelOrder), filling each row left to right. */
export function labels(plan: Plan, job: LabelsJob): Page[] {
  const entries = labelOrder(plan).filter((e) => job.model.parts.some((p) => p.id === e.partId));
  const perSheet = SHEET.columns * SHEET.rows;
  const count = Math.max(1, Math.ceil(entries.length / perSheet));
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    const items: Item[] = [
      text(SHEET.left, 9, `Labels · ${job.name} · Job ${job.shortId} · sheet ${String(i + 1)} of ${String(count)}`, 2.2, {
        colour: GREY,
        max: A4.width - 2 * SHEET.left,
      }),
    ];
    entries.slice(i * perSheet, (i + 1) * perSheet).forEach((entry, j) => {
      const x = SHEET.left + (j % SHEET.columns) * (LABEL.width + SHEET.columnGap);
      const y = SHEET.top + Math.floor(j / SHEET.columns) * LABEL.height;
      items.push(...label(plan, job, entry, x, y));
    });
    pages.push({ ...A4, items });
  }
  return pages;
}

const EDGES: PartEdge[] = ['x0', 'xL', 'y0', 'yW'];

function bandThickness(model: Model, part: Part, edge: PartEdge): number {
  const id = part.edges[edge];
  return id === undefined ? 0 : (model.edgebands.find((e) => e.id === id)?.thickness ?? 0);
}

/** One label with its top-left corner at (x0, y0). */
function label(plan: Plan, job: LabelsJob, entry: LabelEntry, x0: number, y0: number): Item[] {
  const part = job.model.parts.find((p) => p.id === entry.partId);
  if (!part) return [];
  const items: Item[] = [];
  const X = (x: number) => x0 + x;
  const Y = (y: number) => y0 + y;
  const sideB = plan.sideB.find((f) => f.partIds.includes(part.id));
  const manual = plan.manualOps.filter((m) => m.partId === part.id);
  const isSaw = plan.sheets.some((s) => s.sawParts.includes(part.id));
  const spot = stickerSpot(part);

  // Left: the bottom face, label up, and the Edgeband names under it.
  items.push(...faceDrawing(part, sideB !== undefined, spot, X(DRAWING.x), Y(DRAWING.y)));
  items.push(...bandLine(job.model, part, X(INSET.x), Y(30.4)));

  // Right: who and what.
  const owner = job.model.owners.find((o) => o.id === part.ownerId);
  const ownerLabel = printable(owner?.label ?? part.displayName);
  const ownerSize = fitSize(ownerLabel, TEXT_WIDTH, SIZE.owner, SIZE.ownerMin, true);
  const ownerItem = text(X(RIGHT), Y(6.6), ownerLabel, ownerSize, { bold: true, max: TEXT_WIDTH });
  items.push(ownerItem);
  const ownerEnd = ownerItem.kind === 'text' ? textWidth(ownerItem.text, ownerSize, true) : 0;
  const rest = TEXT_WIDTH - ownerEnd - 1.2;
  if (owner?.cabinetName && rest >= 6) {
    items.push(text(X(RIGHT) + ownerEnd + 1.2, Y(6.6), owner.cabinetName, SIZE.cabinet, { max: rest }));
  }
  if (part.partName !== '') {
    const name = printable(part.partName);
    items.push(
      text(X(RIGHT), Y(10.6), name, fitSize(name, TEXT_WIDTH, SIZE.part, SIZE.partMin, true), { bold: true, max: TEXT_WIDTH }),
    );
  }
  const length = part.cutLength + bandThickness(job.model, part, 'x0') + bandThickness(job.model, part, 'xL');
  const width = part.cutWidth + bandThickness(job.model, part, 'y0') + bandThickness(job.model, part, 'yW');
  items.push(text(X(RIGHT), Y(14), `${mmText(length)} × ${mmText(width)} × ${mmText(part.thickness)}`, SIZE.finished));

  // Pills, wrapping onto a second row when they don't fit side by side.
  const pills: { label: string; glyph: Glyph }[] = [
    ...(sideB ? [{ label: `SIDE B ${job.shortId}-${sideB.id}`, glyph: 'half' as const }] : []),
    ...(manual.length > 0 ? [{ label: `${String(manual.length)} MANUAL`, glyph: 'hand' as const }] : []),
    ...(isSaw ? [{ label: 'SAW', glyph: null }] : []),
  ];
  let px = X(RIGHT);
  let pillTop = Y(15.3);
  let below = Y(15.3);
  for (const p of pills) {
    const w = pillWidth(p.label, p.glyph);
    if (px > X(RIGHT) && px + w > X(RIGHT) + TEXT_WIDTH) {
      px = X(RIGHT);
      pillTop += 3;
    }
    items.push(...pill(px, pillTop, p.label, p.glyph));
    px += w + 1;
    below = pillTop + 2.6;
  }

  // The Manual ops spelled out, as many lines as fit above the tick row.
  const lineHeight = SIZE.note * 1.25;
  const room = Math.floor((Y(RULE_Y - 0.4) - below) / lineHeight);
  const lines = manual.flatMap((m) => wrapText(printable(m.text), TEXT_WIDTH, SIZE.note));
  const shown =
    lines.length > room ? [...lines.slice(0, Math.max(0, room - 1)), `+${String(lines.length - room + 1)} more on the cut sheet`] : lines;
  shown.forEach((l, i) => {
    items.push(text(X(RIGHT), below + (i + 1) * lineHeight, l, SIZE.note, { max: TEXT_WIDTH }));
  });

  // Top right: the QR code, and where the Part is cut under it.
  items.push(qrItem(scanPayload(job.shortId, part.id), X(QR_X), Y(INSET.top), LABEL_QR.size, LABEL_QR.quiet, LABEL_QR.ecc));
  items.push(
    text(X(QR_X + LABEL_QR.size), Y(INSET.top + LABEL_QR.size + 1.6), entry.where, SIZE.where, {
      align: 'end',
      max: LABEL_QR.size + 4,
    }),
  );

  // Bottom: the Step tick row; Steps that don't apply are greyed out.
  items.push({ kind: 'line', x1: X(INSET.x), y1: Y(RULE_Y), x2: X(LABEL.width - INSET.x), y2: Y(RULE_Y), lineWidth: 0.3 });
  const applicable = steps({ model: job.model, plan }, part.id);
  let tx = X(INSET.x);
  const ty = Y(36.2);
  for (const step of STEP_ORDER) {
    const name = STEP_NAMES[step];
    if (applicable.includes(step)) {
      items.push(tickBox(tx, ty, 3), text(tx + 3.8, ty, name, SIZE.tick));
      tx += 3.8 + textWidth(name, SIZE.tick) + 3.5;
    } else {
      const s = `— ${name}`;
      items.push(text(tx, ty, s, SIZE.tick, { colour: OFF }));
      tx += textWidth(s, SIZE.tick) + 3.5;
    }
  }
  if (!spot) {
    items.push(
      text(X(LABEL.width - INSET.x), ty, 'No clear sticker spot: place by hand', SIZE.note, {
        align: 'end',
        colour: GREY,
        max: X(LABEL.width - INSET.x) - tx,
      }),
    );
  }
  return items;
}

/** The Edgeband names under the drawing (a block marks banded), and the legend. */
function bandLine(model: Model, part: Part, x: number, baseline: number): Item[] {
  const ids = new Set(Object.values(part.edges).filter((v): v is string => v !== undefined));
  const names = [
    ...model.edgebands.filter((e) => ids.has(e.id)).map((e) => e.name),
    ...[...ids].filter((id) => !model.edgebands.some((e) => e.id === id)),
  ];
  const items: Item[] = [];
  let cx = x;
  if (names.length > 0) {
    items.push({ kind: 'box', x: cx, y: baseline - 1.35, width: 0.8, height: 1.45, fill: BLACK });
    cx += 1.4;
  }
  const band = text(cx, baseline, names.length > 0 ? names.join(', ') : 'no banding', SIZE.note, { max: 26 });
  items.push(band);
  cx += (band.kind === 'text' ? textWidth(band.text, SIZE.note) : 0) + 1;
  items.push(text(cx, baseline, '· bottom face ·', SIZE.note, { colour: GREY }));
  cx += textWidth('· bottom face ·', SIZE.note) + 0.8;
  items.push(
    { kind: 'box', x: cx, y: baseline - 1.45, width: 2.2, height: 1.5, fill: SPOT_FILL, stroke: BLACK, lineWidth: 0.1 },
    text(cx + 2.7, baseline, 'sticker', SIZE.note, { colour: GREY }),
  );
  return items;
}

type Glyph = 'half' | 'hand' | null;

function pillWidth(label: string, glyph: Glyph): number {
  return textWidth(label, SIZE.pill, true) + 1.6 + (glyph ? 2.2 : 0);
}

/**
 * A black pill with white bold text, led by a drawn glyph (the PDF fonts have no ◐ or ✋): a half disc for
 * Side B, a hand for Manual ops.
 */
function pill(x: number, top: number, label: string, glyph: Glyph): Item[] {
  const h = 2.6;
  const items: Item[] = [{ kind: 'box', x, y: top, width: pillWidth(label, glyph), height: h, fill: BLACK }];
  let tx = x + 0.8;
  const cy = top + h / 2;
  if (glyph === 'half') {
    const r = 0.8;
    const c = tx + r;
    items.push(
      { kind: 'polygon', points: circle(c, cy, r, 20), stroke: WHITE, lineWidth: 0.2 },
      { kind: 'polygon', points: circle(c, cy, r, 20).filter(([px]) => px <= c + 1e-9), fill: WHITE },
    );
    tx += 2.2;
  } else if (glyph === 'hand') {
    items.push({ kind: 'box', x: tx, y: cy - 0.2, width: 1.5, height: 1.1, fill: WHITE });
    for (let i = 0; i < 4; i++) items.push({ kind: 'box', x: tx + i * 0.4, y: cy - 0.95, width: 0.3, height: 0.8, fill: WHITE });
    items.push({ kind: 'box', x: tx - 0.35, y: cy, width: 0.4, height: 0.5, fill: WHITE });
    tx += 2.2;
  }
  items.push(text(tx, cy + SIZE.pill * 0.36, label, SIZE.pill, { bold: true, colour: WHITE }));
  return items;
}

function circle(cx: number, cy: number, r: number, n = 16): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** A QR code whose quiet zone of `quiet` modules fills out an `outer` mm square at (x, y). */
function qrItem(payload: string, x: number, y: number, outer: number, quiet: number, ecc: QrEcc): Item {
  const modules = qrCode(payload, ecc);
  const module = outer / (modules.length + 2 * quiet);
  return { kind: 'qr', x: x + quiet * module, y: y + quiet * module, size: modules.length * module, modules };
}

/**
 * The Part's bottom face as seen with the label up: turned over front to back, so y0 (the front) is at the
 * top and x0 stays on the left. Bottom ops outlined, through holes filled, grooves and pockets grey, banded
 * edges thick, Flip Parts shaded, the sticker spot shaded darker.
 */
function faceDrawing(part: Part, flip: boolean, spot: StickerSpot | null, left: number, top: number): Item[] {
  const items: Item[] = [];
  const sc = Math.min(
    (DRAWING.width - 2 * DRAWING.pad) / part.cutLength,
    (DRAWING.height - 2 * DRAWING.pad) / part.cutWidth,
  );
  const w = part.cutLength * sc;
  const h = part.cutWidth * sc;
  const ox = left + (DRAWING.width - w) / 2;
  const oy = top + (DRAWING.height - h) / 2;
  const PX = (x: number) => ox + x * sc;
  const PY = (y: number) => oy + y * sc;

  items.push({ kind: 'box', x: ox, y: oy, width: w, height: h, fill: flip ? FLIP_FILL : WHITE });
  if (spot) {
    items.push({
      kind: 'box',
      x: PX(spot.x),
      y: PY(spot.y),
      width: spot.length * sc,
      height: spot.width * sc,
      fill: SPOT_FILL,
      stroke: BLACK,
      lineWidth: 0.15,
    });
  }
  for (const { op, own } of bottomFaceOps(part)) {
    if (op.kind === 'drill') {
      const points = circle(PX(op.at.x), PY(op.at.y), Math.max((op.diameter / 2) * sc, 0.25));
      items.push(own ? { kind: 'polygon', points, stroke: BLACK, lineWidth: 0.15 } : { kind: 'polygon', points, fill: BLACK });
    } else {
      const r = opRect(op);
      items.push({
        kind: 'box',
        x: PX(r.x0),
        y: PY(r.y0),
        width: Math.max((r.x1 - r.x0) * sc, 0.3),
        height: Math.max((r.y1 - r.y0) * sc, 0.3),
        fill: OP_FILL,
      });
    }
  }
  if (part.grain === 'length') {
    const gy = oy + h * (h > 8 ? 0.85 : 0.5);
    const gx = ox + w * 0.15;
    const gl = w * 0.4;
    items.push(
      { kind: 'line', x1: gx, y1: gy, x2: gx + gl, y2: gy, lineWidth: 0.3 },
      {
        kind: 'polygon',
        points: [
          [gx + gl + 0.3, gy],
          [gx + gl - 1.3, gy - 0.8],
          [gx + gl - 1.3, gy + 0.8],
        ],
        fill: BLACK,
      },
      text(gx, gy - 0.6, 'grain', 1.6),
    );
  }

  // Edges: y0 along the top, yW along the bottom, x0 left, xL right. Banded lines sit inside the outline.
  const banded = (e: PartEdge) => part.edges[e] !== undefined;
  const weight = (e: PartEdge) => (banded(e) ? 1.1 : 0.25);
  const inset = (e: PartEdge) => (banded(e) ? 0.55 : 0);
  items.push(
    { kind: 'line', x1: ox, y1: oy + inset('y0'), x2: ox + w, y2: oy + inset('y0'), lineWidth: weight('y0') },
    { kind: 'line', x1: ox, y1: oy + h - inset('yW'), x2: ox + w, y2: oy + h - inset('yW'), lineWidth: weight('yW') },
    { kind: 'line', x1: ox + inset('x0'), y1: oy, x2: ox + inset('x0'), y2: oy + h, lineWidth: weight('x0') },
    { kind: 'line', x1: ox + w - inset('xL'), y1: oy, x2: ox + w - inset('xL'), y2: oy + h, lineWidth: weight('xL') },
  );
  for (const e of EDGES) items.push(...edgeName(e, banded(e), ox, oy, w, h));
  return items;
}

/** An edge's name beside it: bold after a block when banded, grey when not; y0 also says it is the front. */
function edgeName(e: PartEdge, banded: boolean, ox: number, oy: number, w: number, h: number): Item[] {
  const s = e === 'y0' ? 'y0 · front' : e;
  const size = SIZE.edge;
  const cap = size * 0.72;
  const block = banded ? 1.2 : 0;
  const total = textWidth(s, size, banded) + block;
  const style = banded ? { bold: true } : { colour: GREY };
  const items: Item[] = [];
  if (e === 'y0' || e === 'yW') {
    const baseline = e === 'y0' ? oy - 0.7 : oy + h + size + 0.2;
    const start = ox + w / 2 - total / 2;
    if (banded) items.push({ kind: 'box', x: start, y: baseline - cap, width: 0.7, height: cap, fill: BLACK });
    items.push(text(start + block, baseline, s, size, style));
  } else {
    // Reading up the drawing, letters to the left of the baseline.
    const baseline = e === 'x0' ? ox - 0.8 : ox + w + 0.8 + cap;
    const start = oy + h / 2 + total / 2;
    if (banded) items.push({ kind: 'box', x: baseline - cap, y: start - 0.7, width: cap, height: 0.7, fill: BLACK });
    items.push(text(baseline, start - block, s, size, { ...style, vertical: true }));
  }
  return items;
}

// --- Size ladder ----------------------------------------------------------------------------------

const LADDER_SIZES = [8, 10, 12, 15, 17, 20, 22];
const LADDER_QUIET = [0, 1, 2, 4];
const LADDER_PT = [5, 6, 7, 8, 10, 14, 18];
const LADDER_WEIGHTS = [0.6, 0.8, 1.1, 1.5];

/**
 * The size ladder: a plain A4 page to print at 100 % and scan with the webcam and the wedge scanner, to choose
 * the QR size, quiet zone, text sizes and banded-edge line weight. Codes use LABEL_QR's level and quiet zone.
 */
export function sizeLadder(job: Pick<LabelsJob, 'name' | 'shortId'>): Page {
  const m = 12;
  const items: Item[] = [];
  let y = 20;
  items.push(text(m, y, 'Size ladder: print at 100 %, then scan', 5, { bold: true }));
  const intro =
    'Scan each code in Scan mode with the webcam (cam) and the keyboard-wedge scanner (gun) from about 20 cm, ' +
    `and tick the ones that read first time. Error correction ${LABEL_QR.ecc}, quiet zone ${String(LABEL_QR.quiet)} ` +
    `modules unless marked. Labels print ${String(LABEL_QR.size)} mm codes.`;
  for (const l of wrapText(intro, A4.width - 2 * m, 2.8)) {
    y += 3.6;
    items.push(text(m, y, l, 2.8));
  }

  const camGun = (x: number, top: number): Item[] => [
    tickBox(x, top + 3, 2.6),
    text(x + 3.2, top + 2.6, 'cam', 2.4),
    tickBox(x, top + 6.4, 2.6),
    text(x + 3.2, top + 6, 'gun', 2.4),
  ];
  const short = scanPayload(job.shortId, 'p017');
  const ids: [string, string][] = [
    ['Short Part id', short],
    ['UUID-length Part id', scanPayload(job.shortId, '3f2a9c1e-7b4d-4e0a-9c2b-5d8e1f6a7b30')],
  ];
  for (const [name, payload] of ids) {
    y += 8;
    items.push(text(m, y, `${name}: ${payload}`, 3.2, { bold: true }));
    const n = qrCode(payload, LABEL_QR.ecc).length;
    const rowBottom = y + 3 + Math.max(...LADDER_SIZES);
    let x = m;
    for (const s of LADDER_SIZES) {
      items.push(qrItem(payload, x, rowBottom - s, s, LABEL_QR.quiet, LABEL_QR.ecc));
      items.push(text(x, rowBottom + 3.4, `${String(s)} mm`, 2.6, { bold: true }));
      items.push(text(x, rowBottom + 6.2, `${String(n)}×${String(n)} · ${(s / (n + 2 * LABEL_QR.quiet)).toFixed(2)} mm/mod`, 2, { colour: GREY }));
      items.push(...camGun(x, rowBottom + 7));
      x += Math.max(s, 15) + 4;
    }
    y = rowBottom + 14;
  }

  y += 8;
  items.push(text(m, y, 'Quiet zone, 12 mm codes (short id)', 3.2, { bold: true }));
  const top = y + 3;
  let x = m;
  for (const q of LADDER_QUIET) {
    items.push({ kind: 'box', x, y: top, width: 12, height: 12, stroke: BLACK, lineWidth: 0.15 });
    items.push(qrItem(short, x, top, 12, q, LABEL_QR.ecc));
    items.push(text(x, top + 15.4, `${String(q)} modules`, 2.6, { bold: true }));
    items.push(...camGun(x, top + 16));
    x += 26;
  }
  y = top + 24;

  y += 8;
  items.push(text(m, y, "Text at arm's length", 3.2, { bold: true }));
  y += 1;
  for (const pt of LADDER_PT) {
    const size = pt * PT;
    y += size * 1.25 + 1;
    items.push(
      tickBox(m, y, 2.6),
      text(m + 4, y, `${String(pt)} pt · B3 · Left side 720 × 560 · W18-1-A #3 · SIDE B ${job.shortId}-B1`, size),
    );
  }

  y += 9;
  items.push(text(m, y, 'Banded-edge line weight', 3.2, { bold: true }));
  x = m;
  for (const wgt of LADDER_WEIGHTS) {
    const by = y + 3;
    items.push(
      { kind: 'box', x, y: by, width: 28, height: 10, stroke: BLACK, lineWidth: 0.25 },
      { kind: 'line', x1: x, y1: by + 10 - wgt / 2, x2: x + 28, y2: by + 10 - wgt / 2, lineWidth: wgt },
      text(x, by + 13.4, `${String(wgt)} mm`, 2.6, { bold: true }),
      tickBox(x + 16, by + 13.6, 2.6),
    );
    x += 38;
  }

  items.push(text(m, A4.height - 7, `Size ladder · ${job.name} · Job ${job.shortId}`, 2.6, { colour: GREY }));
  return { ...A4, items };
}
