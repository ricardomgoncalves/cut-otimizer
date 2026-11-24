// "Fix by hand" (PRD 11.7): a Changed (cut) Part that is already cut keeps its ticks and gets a Manual op
// describing what changed, so it shows on its label and the cut sheet. The text says what to do to the
// piece in hand: "now 596 wide", "hole Ø5 added at 32, 96". Sizes are cut sizes and op positions are in the
// Part's cut frame (like Side A), in mm.
import { mmText } from './units.ts';
import type { CncOp, Model, Part, Point } from './model.ts';

/** µm -> mm, at most 2 decimals, no trailing zeros (`21500` -> `21.5`). */
const mm = (um: number) => mmText(um, 2);

const at = (p: Point) => `${mm(p.x)}, ${mm(p.y)}`;

/**
 * What changed between the Part as it was cut (`before`, from `current`) and as the new export has it
 * (`after`, from `next`), in words, joined with "; ".
 */
export function describeChange(before: Part, after: Part, current: Model, next: Model): string {
  const out: string[] = [];
  const oldSheet = current.sheets.find((s) => s.id === before.sheetId);
  const newSheet = next.sheets.find((s) => s.id === after.sheetId);
  if (before.sheetId !== after.sheetId) out.push(`now on ${newSheet?.name ?? after.sheetId}`);
  else if (
    oldSheet &&
    newSheet &&
    (oldSheet.name !== newSheet.name ||
      oldSheet.thickness !== newSheet.thickness ||
      oldSheet.grain !== newSheet.grain ||
      oldSheet.length !== newSheet.length ||
      oldSheet.width !== newSheet.width)
  ) {
    out.push(`Sheet now ${newSheet.name}`);
  }

  const longer = before.cutLength !== after.cutLength;
  const wider = before.cutWidth !== after.cutWidth;
  if (longer && wider) out.push(`now ${mm(after.cutLength)} × ${mm(after.cutWidth)}`);
  else if (longer) out.push(`now ${mm(after.cutLength)} long`);
  else if (wider) out.push(`now ${mm(after.cutWidth)} wide`);
  if (before.thickness !== after.thickness) out.push(`now ${mm(after.thickness)} thick`);
  if (before.grain !== after.grain) out.push(after.grain === 'none' ? 'grain no longer matters' : 'grain now along the length');

  out.push(...opChanges(before.top, after.top, ''), ...opChanges(before.bottom, after.bottom, ' on the bottom'));
  return out.length > 0 ? out.join('; ') : 'changed';
}

/** Ops added and removed on one face, like ops grouped with their positions joined by " and ". */
function opChanges(before: readonly CncOp[], after: readonly CncOp[], face: string): string[] {
  const left = [...before.map((op) => JSON.stringify(op))];
  const added: CncOp[] = [];
  for (const op of after) {
    const i = left.indexOf(JSON.stringify(op));
    if (i >= 0) left.splice(i, 1);
    else added.push(op);
  }
  const removed = left.map((text) => JSON.parse(text) as CncOp);
  return [...grouped(added, `added${face}`), ...grouped(removed, `no longer wanted${face}`)];
}

function grouped(ops: readonly CncOp[], verb: string): string[] {
  const groups = new Map<string, string[]>();
  for (const op of ops) {
    const { what, where } = words(op);
    const key = `${what} ${verb}`;
    groups.set(key, [...(groups.get(key) ?? []), where]);
  }
  return [...groups].map(([key, wheres]) => `${key} ${wheres.join(' and ')}`);
}

function words(op: CncOp): { what: string; where: string } {
  switch (op.kind) {
    case 'drill':
      return {
        what: `hole Ø${mm(op.diameter)}${op.depth === 'through' ? '' : ` × ${mm(op.depth)} deep`}`,
        where: `at ${at(op.at)}`,
      };
    case 'groove':
      return { what: `groove ${mm(op.width)} wide × ${mm(op.depth)} deep`, where: `from ${at(op.from)} to ${at(op.to)}` };
    case 'pocket':
      return { what: `pocket ${mm(op.length)} × ${mm(op.width)} × ${mm(op.depth)} deep`, where: `at ${at(op.centre)}` };
  }
}
