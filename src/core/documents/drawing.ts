// Drawing helpers for Part drawings on paper: circles (as polygons), the Flip mark, arrows, and CNC ops
// mapped from a Part's cut frame onto the page.
import type { CncOp, Point } from '../model.ts';
import { BLACK, type Item, type PolygonItem } from './page.ts';

/** Grooves and pockets on drawings. */
export const OP_FILL = '#bbbbbb';

/** A circle as a 24-sided polygon. */
export function circle(cx: number, cy: number, r: number, o: { fill?: string; stroke?: string; lineWidth?: number } = {}): PolygonItem {
  const points: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { kind: 'polygon', points, ...o };
}

/** The Flip Part mark: a circle, its left half filled. */
export function flipMark(cx: number, cy: number, r: number): Item[] {
  const half: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 + (i / 12) * Math.PI;
    half.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return [
    circle(cx, cy, r, { fill: '#ffffff', stroke: BLACK, lineWidth: 0.2 }),
    { kind: 'polygon', points: half, fill: BLACK },
  ];
}

/** An arrow from (x1, y1) to (x2, y2): a line and a filled head. */
export function arrow(x1: number, y1: number, x2: number, y2: number, lineWidth = 0.25, head = 1.2): Item[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return [];
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  return [
    { kind: 'line', x1, y1, x2: bx, y2: by, lineWidth },
    {
      kind: 'polygon',
      points: [
        [x2, y2],
        [bx - uy * head * 0.45, by + ux * head * 0.45],
        [bx + uy * head * 0.45, by - ux * head * 0.45],
      ],
      fill: BLACK,
    },
  ];
}

/**
 * One CNC op drawn on the page. `toPage` maps a point of the Part's cut frame (L × W) onto the page and
 * `scale` is mm on paper per µm. Drills are circles at their true diameter (filled when through), grooves
 * (clipped to the Part) and pockets are grey rectangles.
 */
export function opItems(
  op: CncOp,
  toPage: (p: Point) => [number, number],
  scale: number,
  cutLength: number,
  cutWidth: number,
): Item[] {
  const rect = (x0: number, y0: number, x1: number, y1: number): Item[] => {
    const cx0 = Math.max(0, Math.min(x0, x1));
    const cx1 = Math.min(cutLength, Math.max(x0, x1));
    const cy0 = Math.max(0, Math.min(y0, y1));
    const cy1 = Math.min(cutWidth, Math.max(y0, y1));
    if (cx1 <= cx0 || cy1 <= cy0) return [];
    const [ax, ay] = toPage({ x: cx0, y: cy0 });
    const [bx, by] = toPage({ x: cx1, y: cy1 });
    return [{ kind: 'box', x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), fill: OP_FILL }];
  };
  switch (op.kind) {
    case 'drill': {
      const [x, y] = toPage(op.at);
      const r = Math.max((op.diameter / 2) * scale, 0.3);
      return [
        op.depth === 'through'
          ? circle(x, y, r, { fill: BLACK })
          : circle(x, y, r, { fill: '#ffffff', stroke: BLACK, lineWidth: 0.15 }),
      ];
    }
    case 'groove': {
      const half = op.width / 2;
      return op.from.y === op.to.y
        ? rect(op.from.x, op.from.y - half, op.to.x, op.to.y + half)
        : rect(op.from.x - half, op.from.y, op.to.x + half, op.to.y);
    }
    case 'pocket':
      return rect(
        op.centre.x - op.length / 2,
        op.centre.y - op.width / 2,
        op.centre.x + op.length / 2,
        op.centre.y + op.width / 2,
      );
  }
}
