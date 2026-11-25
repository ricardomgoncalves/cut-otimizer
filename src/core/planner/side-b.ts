// Side B (ticket #28; PRD stories 4.1–4.4, 5.4): Flip Parts, their orientation against the Fence corner,
// the Side B files they share, and the Job's Manual ops. Internal to the Planner: callers use plan().
import { describeCncOp } from '../manual-ops.ts';
import type { CncOp, ManualOp, Model, Part, Point } from '../model.ts';
import type { Settings } from '../settings.ts';

/** A Part edge, named as in the export. */
export type Edge = 'x0' | 'xL' | 'y0' | 'yW';

/** Quarter turns (counter-clockwise) of the bottom view, after flipping the Part about its X axis. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * One Side B file: a Flip Part set bottom-up against the Fence corner, shared by every Flip Part with the
 * same cut size, Side B ops and orientation. The file is a bottom view: the origin is the Fence corner,
 * the long fence runs along X (y = 0) and the short fence along Y (x = 0).
 */
export interface SideBFile {
  /** `B1`, `B2`… in Run order of each file's first Part. The file is `<Job>-B<n>.side-b.dxf`. */
  id: string;
  turns: QuarterTurns;
  /** The Part edge against the long fence (the file's X axis). */
  longFence: Edge;
  /** The Part edge against the short fence (the file's Y axis). */
  shortFence: Edge;
  cutLength: number;
  cutWidth: number;
  /** The Part's footprint in the file: along X (the long fence), along Y (the short fence). */
  length: number;
  width: number;
  /** The blind CNC `bottom` ops, in the Part's cut frame (seen from the top, as `Part.bottom`). */
  ops: CncOp[];
  /** Flip Parts that run this file, in Run order. */
  partIds: string[];
}

/** A Manual op of one Part of the Job. */
export interface JobManualOp extends ManualOp {
  partId: string;
}

/** Which Part edge lies on each fence for each number of quarter turns. */
const FENCES: Record<QuarterTurns, { longFence: Edge; shortFence: Edge }> = {
  0: { longFence: 'yW', shortFence: 'x0' },
  1: { longFence: 'x0', shortFence: 'y0' },
  2: { longFence: 'y0', shortFence: 'xL' },
  3: { longFence: 'xL', shortFence: 'yW' },
};

/** Tried in this order; a later one wins only when strictly better. The Part's length along the long fence first. */
const TURN_ORDER: QuarterTurns[] = [0, 2, 1, 3];

/**
 * A point of the Part's cut frame (seen from the top) in a Side B file: the Part is flipped about its X axis
 * (`y ← width − y`), turned `turns` quarter turns counter-clockwise, and pushed into the Fence corner.
 */
export function sideBPoint(
  file: Pick<SideBFile, 'turns' | 'cutLength' | 'cutWidth'>,
  p: Point,
): Point {
  const L = file.cutLength;
  const W = file.cutWidth;
  switch (file.turns) {
    case 0:
      return { x: p.x, y: W - p.y };
    case 1:
      return { x: p.y, y: p.x };
    case 2:
      return { x: L - p.x, y: p.y };
    case 3:
      return { x: W - p.y, y: L - p.x };
  }
}

function opCentre(op: CncOp): Point {
  switch (op.kind) {
    case 'drill':
      return op.at;
    case 'groove':
      return { x: (op.from.x + op.to.x) / 2, y: (op.from.y + op.to.y) / 2 };
    case 'pocket':
      return op.centre;
  }
}

/**
 * The turns a Part may take on the bed. With tiling, a Part longer than the bed lies long along X (Tiles
 * only go along X), and one that fits the bed is kept within it; without tiling, any turn.
 */
function allowedTurns(part: Part, settings: Settings): QuarterTurns[] {
  if (!settings.allowTiling) return TURN_ORDER;
  const size = (t: QuarterTurns) =>
    t % 2 === 0 ? { x: part.cutLength, y: part.cutWidth } : { x: part.cutWidth, y: part.cutLength };
  const inBed = TURN_ORDER.filter((t) => size(t).x <= settings.bedLength && size(t).y <= settings.bedWidth);
  if (inBed.length > 0) return inBed;
  const tiled = TURN_ORDER.filter((t) => size(t).y <= settings.bedWidth);
  return tiled.length > 0 ? tiled : TURN_ORDER;
}

/** The orientation that puts the ops closest to the two fence edges (least total distance from both). */
function bestTurns(part: Part, ops: CncOp[], turnsAllowed: QuarterTurns[]): QuarterTurns {
  let best = turnsAllowed[0] ?? 0;
  let bestScore = Infinity;
  for (const turns of turnsAllowed) {
    const score = ops.reduce((sum, op) => {
      const c = sideBPoint({ turns, cutLength: part.cutLength, cutWidth: part.cutWidth }, opCentre(op));
      return sum + c.x + c.y;
    }, 0);
    if (score < bestScore) {
      best = turns;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Groups the Flip Parts into Side B files and lists the Job's Manual ops. `runOrder` is every Part id in
 * Run order; Side B files are numbered by where their first Part appears in it.
 */
export function sideB(
  model: Model,
  settings: Settings,
  runOrder: string[],
): { files: SideBFile[]; manualOps: JobManualOp[] } {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const files = new Map<string, SideBFile>();
  const manualOps: JobManualOp[] = [];

  for (const id of runOrder) {
    const part = byId.get(id);
    if (!part) continue;
    manualOps.push(...part.manualOps.map((op) => ({ partId: id, ...op })));
    const manual = part.bottom.filter((op) => settings.manualBottomOpKinds.includes(op.kind));
    manualOps.push(
      ...manual.map(
        (op): JobManualOp => ({ partId: id, reason: 'manualKind', face: 'bottom', text: describeCncOp(op, 'bottom') }),
      ),
    );

    const ops = part.bottom.filter((op) => !settings.manualBottomOpKinds.includes(op.kind));
    if (ops.length === 0) continue;
    const turns = bestTurns(part, ops, allowedTurns(part, settings));
    // An exact match only: nothing is turned or mirrored to make two Parts share a file.
    const key = JSON.stringify([part.cutLength, part.cutWidth, turns, ops.map((op) => JSON.stringify(op)).sort()]);
    const file = files.get(key);
    if (file) {
      file.partIds.push(id);
      continue;
    }
    const along = turns % 2 === 0;
    files.set(key, {
      id: `B${String(files.size + 1)}`,
      turns,
      ...FENCES[turns],
      cutLength: part.cutLength,
      cutWidth: part.cutWidth,
      length: along ? part.cutLength : part.cutWidth,
      width: along ? part.cutWidth : part.cutLength,
      ops,
      partIds: [id],
    });
  }
  return { files: [...files.values()], manualOps };
}
