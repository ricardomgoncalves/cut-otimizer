// DXF writer: Plan -> files for CAM, per the DXF layer grammar v1 (see the PRD).
// ASCII DXF R12, mm, Z = 0, only CIRCLE and closed 4-vertex POLYLINE, nothing on layer 0.
// Side A: top view of a Blank, origin at its front-left corner, X along the Board length.
// Output is a pure function of the Plan, so the same Plan gives byte-identical files.
import type { CncOp, Point } from '../model.ts';
import type { Blank, Placement, Plan } from '../planner/index.ts';
import { mmToken } from '../units.ts';

/** File name -> DXF text, in Run order (Sheets, Boards, Blanks). */
export function toDxfFiles(plan: Plan): Map<string, string> {
  const files = new Map<string, string>();
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) {
        files.set(`${blank.id}.side-a.dxf`, sideA(blank, plan.settings.clampMargin));
      }
    }
  }
  return files;
}

type Entity =
  | { type: 'circle'; layer: string; centre: Point; diameter: number }
  | { type: 'rect'; layer: string; min: Point; max: Point };

const REF_LAYERS = ['REF_V1', 'REF_BLANK', 'REF_CLAMP'];
const OUTLINE = 'OUTLINE_THRU';

function sideA(blank: Blank, clamp: number): string {
  const entities: Entity[] = [
    { type: 'rect', layer: 'REF_BLANK', min: { x: 0, y: 0 }, max: { x: blank.length, y: blank.width } },
    {
      type: 'rect',
      layer: 'REF_CLAMP',
      min: { x: clamp, y: clamp },
      max: { x: blank.length - clamp, y: blank.width - clamp },
    },
  ];
  for (const part of blank.parts) entities.push(...partEntities(part));

  const cutLayers = [...new Set(entities.map((e) => e.layer))]
    .filter((l) => !REF_LAYERS.includes(l) && l !== OUTLINE)
    .sort();
  const layers = [...REF_LAYERS, OUTLINE, ...cutLayers];
  return writeDxf(layers, entities);
}

/** A Part's outline and Side A ops, moved from its cut frame into the Blank frame. */
function partEntities(part: Placement): Entity[] {
  // Turned Parts are rotated 90° counter-clockwise: the Part's X runs along the Blank's +Y.
  const toBlank = (p: Point): Point =>
    part.rotated
      ? { x: part.x + (part.cutWidth - p.y), y: part.y + p.x }
      : { x: part.x + p.x, y: part.y + p.y };
  const rect = (layer: string, a: Point, b: Point): Entity => {
    const [p, q] = [toBlank(a), toBlank(b)];
    return {
      type: 'rect',
      layer,
      min: { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) },
      max: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) },
    };
  };

  const entities: Entity[] = [rect(OUTLINE, { x: 0, y: 0 }, { x: part.cutLength, y: part.cutWidth })];
  for (const op of part.ops) {
    const entity = opEntity(op, part, rect, toBlank);
    if (entity) entities.push(entity);
  }
  return entities;
}

function opEntity(
  op: CncOp,
  part: Placement,
  rect: (layer: string, a: Point, b: Point) => Entity,
  toBlank: (p: Point) => Point,
): Entity | null {
  switch (op.kind) {
    case 'drill': {
      const depth = op.depth === 'through' ? 'THRU' : `Z${mmToken(op.depth)}`;
      return {
        type: 'circle',
        layer: `DRILL_D${mmToken(op.diameter)}_${depth}`,
        centre: toBlank(op.at),
        diameter: op.diameter,
      };
    }
    case 'groove': {
      // Axis-aligned slot, width centred on the from-to line, clipped to the cut outline.
      // (Diagonal grooves don't occur in v1 exports; they would need a Manual op, ticket #28.)
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
      return rect(`GROOVE_W${mmToken(op.width)}_Z${mmToken(op.depth)}`, min, max);
    }
    case 'pocket': {
      const min = { x: op.centre.x - op.length / 2, y: op.centre.y - op.width / 2 };
      const max = { x: op.centre.x + op.length / 2, y: op.centre.y + op.width / 2 };
      return rect(`POCKET_Z${mmToken(op.depth)}`, min, max);
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
  g(9, '$INSUNITS');
  g(70, 4); // millimetres
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
