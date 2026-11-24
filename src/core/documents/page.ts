// The page model: what a printed page holds, as positioned items. All lengths are mm, origin at the
// page's top-left corner, y down (as on paper and in SVG; the PDF renderer flips it). Colours are
// `#rrggbb`. Text is drawn in Helvetica (regular or bold); `y` is its baseline.

export interface Page {
  width: number;
  height: number;
  items: Item[];
}

/** A4 portrait. */
export const A4 = { width: 210, height: 297 } as const;

export interface BoxItem {
  kind: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  /** Outline colour; no outline when missing. */
  stroke?: string;
  lineWidth?: number;
  dash?: number[];
}

export interface TextItem {
  kind: 'text';
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  /** Font size in mm (the em height). */
  size: number;
  bold?: boolean;
  /** Where `x` is on the text. Default `start`. */
  align?: 'start' | 'middle' | 'end';
  colour?: string;
}

export interface LineItem {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineWidth: number;
  colour?: string;
  dash?: number[];
}

export interface PolygonItem {
  kind: 'polygon';
  points: [number, number][];
  fill?: string;
  stroke?: string;
  lineWidth?: number;
}

/** A rectangle filled with 45° lines (waste). */
export interface HatchItem {
  kind: 'hatch';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Distance between the lines, measured along X. */
  spacing: number;
  lineWidth: number;
  colour: string;
}

/** A QR code: `modules[row][col]`, true = dark, drawn as a square `size` mm wide (quiet zone not included). */
export interface QrItem {
  kind: 'qr';
  x: number;
  y: number;
  size: number;
  modules: boolean[][];
}

export type Item = BoxItem | TextItem | LineItem | PolygonItem | HatchItem | QrItem;

export const BLACK = '#000000';

/**
 * The hatch lines of a rectangle: 45° lines rising to the right (on paper), `spacing` apart along X,
 * clipped to the rectangle. Both renderers draw these, so the PDF and the preview match.
 */
export function hatchLines(h: HatchItem): [number, number, number, number][] {
  const lines: [number, number, number, number][] = [];
  // A line is x + y' = c, with y' measured up from the rectangle's bottom edge.
  const bottom = h.y + h.height;
  for (let c = h.spacing / 2; c < h.width + h.height; c += h.spacing) {
    const x1 = Math.max(0, c - h.height);
    const x2 = Math.min(h.width, c);
    if (x2 - x1 <= 1e-9) continue;
    lines.push([h.x + x1, bottom - (c - x1), h.x + x2, bottom - (c - x2)]);
  }
  return lines;
}

/** Every dark QR module as a square: [x, y, side]. */
export function qrSquares(q: QrItem): [number, number, number][] {
  const n = q.modules.length;
  if (n === 0) return [];
  const side = q.size / n;
  const out: [number, number, number][] = [];
  q.modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) out.push([q.x + c * side, q.y + r * side, side]);
    });
  });
  return out;
}
