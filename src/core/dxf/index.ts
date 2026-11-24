// DXF writer: Plan -> files for CAM, per the DXF layer grammar v1 (see the PRD).
// ASCII DXF R12, mm, Z = 0, only CIRCLE and closed 4-vertex POLYLINE, nothing on layer 0.
// Side A: top view of a Blank, origin at its front-left corner, X along the Board length.
// Side B: bottom view of one Flip Part, origin at the Fence corner, in the orientation the Planner chose.
// Output is a pure function of the Plan, so the same Plan gives byte-identical files.
import type { CncOp, Point } from '../model.ts';
import { sideBPoint, type Blank, type Placement, type Plan, type SideBFile } from '../planner/index.ts';
import { mmToken } from '../units.ts';

/**
 * File name -> DXF text, in Run order: Side A per Blank (Sheets, Boards, Blanks), then Side B per Side B
 * file (`<job>-B<n>.side-b.dxf`). `job` names the Job in Side B file names (the Job's short id).
 */
export function toDxfFiles(plan: Plan, job: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) {
        files.set(`${blank.id}.side-a.dxf`, sideA(blank, blank.clampMargin ?? plan.settings.clampMargin));
      }
    }
  }
  for (const file of plan.sideB) files.set(sideBFileName(job, file), sideB(file));
  return files;
}

/** `<job>-B<n>.side-b.dxf`. */
export function sideBFileName(job: string, file: Pick<SideBFile, 'id'>): string {
  return `${job}-${file.id}.side-b.dxf`;
}

type Entity =
  | { type: 'circle'; layer: string; centre: Point; diameter: number }
  | { type: 'rect'; layer: string; min: Point; max: Point };

const REF_LAYERS = ['REF_V1', 'REF_BLANK', 'REF_CLAMP'];
const OUTLINE = 'OUTLINE_THRU';
const REF_PART = 'REF_PART';

/** A Part's cut size and a map from its cut frame (seen from the top) into the file. */
interface PartFrame {
  cutLength: number;
  cutWidth: number;
  to: (p: Point) => Point;
}

const cutLayers = (entities: Entity[], skip: string[]) =>
  [...new Set(entities.map((e) => e.layer))].filter((l) => !skip.includes(l)).sort();

/**
 * One row of the layer legend: a cut layer used in the Job's files, by stock thickness, with how many
 * entities sit on it. Reference layers (`REF_*`) are not listed.
 */
export interface LayerUse {
  layer: string;
  /** Stock thickness (µm) of the Parts the entities belong to. */
  thickness: number;
  count: number;
  kind: 'outline' | 'drill' | 'groove' | 'pocket';
  /** Drills only. */
  diameter?: number;
}

/** The reference layers the Job's files use, in file order (`REF_PART` only with Side B files). */
export function referenceLayers(plan: Plan): string[] {
  return plan.sideB.length > 0 ? [...REF_LAYERS, REF_PART] : [...REF_LAYERS];
}

/**
 * Every cut layer the Job's files use (Side A and Side B), by stock thickness, sorted by layer name then
 * thickness. `thicknessOf` gives a Part's thickness (Side B files carry only Part ids).
 */
export function layerUsage(plan: Plan, thicknessOf: (partId: string) => number): LayerUse[] {
  const uses = new Map<string, LayerUse>();
  const add = (entities: Entity[], thickness: number) => {
    for (const e of entities) {
      if (e.layer.startsWith('REF_')) continue;
      const key = `${e.layer} ${String(thickness)}`;
      const use = uses.get(key);
      if (use) {
        use.count++;
        continue;
      }
      const kind = e.type === 'circle' ? 'drill' : e.layer === OUTLINE ? 'outline' : e.layer.startsWith('GROOVE_') ? 'groove' : 'pocket';
      uses.set(key, { layer: e.layer, thickness, count: 1, kind, ...(e.type === 'circle' ? { diameter: e.diameter } : {}) });
    }
  };
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) add(sideAEntities(blank, blank.clampMargin ?? plan.settings.clampMargin), sheet.thickness);
    }
  }
  for (const file of plan.sideB) add(sideBEntities(file), thicknessOf(file.partIds[0] ?? ''));
  return [...uses.values()].sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : a.thickness - b.thickness));
}

function sideA(blank: Blank, clamp: number): string {
  const entities = sideAEntities(blank, clamp);
  return writeDxf([...REF_LAYERS, OUTLINE, ...cutLayers(entities, [...REF_LAYERS, OUTLINE])], entities);
}

function sideAEntities(blank: Blank, clamp: number): Entity[] {
  const entities: Entity[] = [
    { type: 'rect', layer: 'REF_BLANK', min: { x: 0, y: 0 }, max: { x: blank.length, y: blank.width } },
    {
      type: 'rect',
      layer: 'REF_CLAMP',
      min: { x: clamp, y: clamp },
      max: { x: blank.length - clamp, y: blank.width - clamp },
    },
  ];
  for (const part of blank.parts) {
    const frame = placementFrame(part);
    entities.push(rect(frame, OUTLINE, { x: 0, y: 0 }, { x: part.cutLength, y: part.cutWidth }));
    entities.push(...opEntities(part.ops, frame));
  }
  return entities;
}

/** The Flip Part's outline on REF_PART and its blind `bottom` ops, in the bottom view. No OUTLINE_THRU. */
function sideB(file: SideBFile): string {
  const entities = sideBEntities(file);
  return writeDxf(['REF_V1', REF_PART, ...cutLayers(entities, [REF_PART])], entities);
}

function sideBEntities(file: SideBFile): Entity[] {
  const frame: PartFrame = { cutLength: file.cutLength, cutWidth: file.cutWidth, to: (p) => sideBPoint(file, p) };
  return [
    rect(frame, REF_PART, { x: 0, y: 0 }, { x: file.cutLength, y: file.cutWidth }),
    ...opEntities(file.ops, frame),
  ];
}

/** A placed Part's frame on its Blank. */
function placementFrame(part: Placement): PartFrame {
  // Turned Parts are rotated 90° counter-clockwise: the Part's X runs along the Blank's +Y.
  const to = (p: Point): Point =>
    part.rotated
      ? { x: part.x + (part.cutWidth - p.y), y: part.y + p.x }
      : { x: part.x + p.x, y: part.y + p.y };
  return { cutLength: part.cutLength, cutWidth: part.cutWidth, to };
}

/** A rectangle given by two corners in the Part's cut frame. */
function rect(frame: PartFrame, layer: string, a: Point, b: Point): Entity {
  const [p, q] = [frame.to(a), frame.to(b)];
  return {
    type: 'rect',
    layer,
    min: { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) },
    max: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) },
  };
}

function opEntities(ops: CncOp[], frame: PartFrame): Entity[] {
  return ops.flatMap((op) => opEntity(op, frame) ?? []);
}

function opEntity(op: CncOp, part: PartFrame): Entity | null {
  switch (op.kind) {
    case 'drill': {
      const depth = op.depth === 'through' ? 'THRU' : `Z${mmToken(op.depth)}`;
      return {
        type: 'circle',
        layer: `DRILL_D${mmToken(op.diameter)}_${depth}`,
        centre: part.to(op.at),
        diameter: op.diameter,
      };
    }
    case 'groove': {
      // Axis-aligned slot, width centred on the from-to line, clipped to the cut outline.
      // (Diagonal grooves are Manual ops: Import keeps them out of `top` and `bottom`.)
      const half = op.width / 2;
      const alongX = op.from.y === op.to.y;
      const lo: Point = alongX
        ? { x: Math.min(op.from.x, op.to.x), y: op.from.y - half }
        : { x: op.from.x - half, y: Math.min(op.from.y, op.to.y) };
      const hi: Point = alongX
        ? { x: Math.max(op.from.x, op.to.x), y: op.from.y + half }
        : { x: op.from.x + half, y: Math.max(op.from.y, op.to.y) };
      const min = { x: Math.max(lo.x, 0), y: Math.max(lo.y, 0) };
      const max = { x: Math.min(hi.x, part.cutLength), y: Math.min(hi.y, part.cutWidth) };
      if (min.x >= max.x || min.y >= max.y) return null;
      return rect(part, `GROOVE_W${mmToken(op.width)}_Z${mmToken(op.depth)}`, min, max);
    }
    case 'pocket': {
      const min = { x: op.centre.x - op.length / 2, y: op.centre.y - op.width / 2 };
      const max = { x: op.centre.x + op.length / 2, y: op.centre.y + op.width / 2 };
      return rect(part, `POCKET_Z${mmToken(op.depth)}`, min, max);
    }
  }
}

// --- R12 serialisation -------------------------------------------------------------------------

/** µm -> mm text: exact to 0.1 µm, no trailing zeros (`55750` -> `55.75`). */
function num(um: number): string {
  const s = (um / 1000).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function writeDxf(layers: string[], entities: Entity[]): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    out.push(String(code).padStart(3), String(value));
  };

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  // R12 has no units variable ($INSUNITS came with R14): the grammar fixes units to mm.
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, '0.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const layer of layers) {
    g(0, 'LAYER');
    g(2, layer);
    g(70, 0);
    g(62, layer.startsWith('REF_') ? 8 : 7); // grey for reference layers, white for cut layers
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of entities) {
    if (e.type === 'circle') {
      g(0, 'CIRCLE');
      g(8, e.layer);
      g(10, num(e.centre.x));
      g(20, num(e.centre.y));
      g(30, 0);
      g(40, num(e.diameter / 2));
    } else {
      g(0, 'POLYLINE');
      g(8, e.layer);
      g(66, 1);
      g(10, 0);
      g(20, 0);
      g(30, 0);
      g(70, 1); // closed
      const corners: Point[] = [
        e.min,
        { x: e.max.x, y: e.min.y },
        e.max,
        { x: e.min.x, y: e.max.y },
      ];
      for (const c of corners) {
        g(0, 'VERTEX');
        g(8, e.layer);
        g(10, num(c.x));
        g(20, num(c.y));
        g(30, 0);
      }
      g(0, 'SEQEND');
      g(8, e.layer);
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${out.join('\n')}\n`;
}
