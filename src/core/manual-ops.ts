// Manual ops spelled out for people: the PDF, the label and the Job's Manual ops list read this text.
import type { CncOp, Face, ManualOp } from './model.ts';
import type { Op as ExportOp } from './import/parts-export.v1.generated.ts';

/** µm -> mm, at most 2 decimals, no trailing zeros (`21500` -> `21.5`). */
function mm(um: number): string {
  return String(Math.round(um / 10) / 100);
}

/** `x 10, y 20`: only the axes the point has, in x, y, z order. */
function at(p: Partial<Record<'x' | 'y' | 'z', number>>): string {
  return (['x', 'y', 'z'] as const)
    .flatMap((axis) => (p[axis] === undefined ? [] : [`${axis} ${mm(p[axis])}`]))
    .join(', ');
}

/** An export op, as written in the export (finished frame). */
export function describeExportOp(op: ExportOp): string {
  const face = op.face;
  switch (op.type) {
    case 'drill': {
      const depth = op.through === true ? 'through' : `× ${mm(op.depth ?? 0)} deep`;
      return `Drill Ø${mm(op.diameter)} ${depth} on ${face} at ${at(op.at)}`;
    }
    case 'groove':
      return `Groove ${mm(op.width)} wide × ${mm(op.depth)} deep on ${face} from ${at(op.from)} to ${at(op.to)}`;
    case 'pocket':
      return `Pocket ${mm(op.length)} × ${mm(op.width)} × ${mm(op.depth)} deep on ${face} at ${at(op.centre)}`;
  }
}

/** A `top` or `bottom` op in the cut frame. */
export function describeCncOp(op: CncOp, face: Face): string {
  switch (op.kind) {
    case 'drill': {
      const depth = op.depth === 'through' ? 'through' : `× ${mm(op.depth)} deep`;
      return `Drill Ø${mm(op.diameter)} ${depth} on ${face} at ${at(op.at)}`;
    }
    case 'groove':
      return `Groove ${mm(op.width)} wide × ${mm(op.depth)} deep on ${face} from ${at(op.from)} to ${at(op.to)}`;
    case 'pocket':
      return `Pocket ${mm(op.length)} × ${mm(op.width)} × ${mm(op.depth)} deep on ${face} at ${at(op.centre)}`;
  }
}

/** A mitred end of a Part. */
export function mitreOp(end: 'x0' | 'xL', angle: number, longFace: 'top' | 'bottom'): ManualOp {
  return { reason: 'notDrawable', face: end, text: `Mitre the ${end} end ${String(angle)}° (long point on ${longFace})` };
}
