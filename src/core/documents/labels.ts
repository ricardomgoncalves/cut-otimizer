// Part labels (PRD stories 8.1–8.3): one sticker per Part on L7163 sheets (2 × 7 labels of 99.1 × 38.1 mm),
// in Run order, stuck on the Part's `bottom` face (the face that ends up hidden). Each label draws that face
// as seen with the label up, says what the Part is, carries the QR code Scan mode reads, and a Step tick row.
import type { CncOp, Part } from '../model.ts';

/** The sticker: one L7163 label, mm. */
export const LABEL = { width: 99.1, height: 38.1 } as const;

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
