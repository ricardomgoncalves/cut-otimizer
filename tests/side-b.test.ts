import { describe, expect, it } from 'vitest';
import type { CncOp, Model, Part } from '../src/core/model.ts';
import { plan, sideBPoint } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

const mm = (n: number) => Math.round(n * 1000);

const cup = (x: number, y: number): CncOp => ({
  kind: 'drill',
  at: { x: mm(x), y: mm(y) },
  diameter: mm(35),
  depth: mm(13),
});

/** A 700 × 400 mm door with blind `bottom` ops. */
function door(id: string, bottom: CncOp[], size: { length: number; width: number } = { length: 700, width: 400 }): Part {
  return {
    id,
    name: 's0.door.leaf[0]',
    partName: 'Door',
    displayName: `${id} · Door`,
    ownerId: 'c1',
    sheetId: 's1',
    thickness: mm(18),
    cutLength: mm(size.length),
    cutWidth: mm(size.width),
    grain: 'none',
    top: [],
    bottom,
    manualOps: [],
    edges: {},
  };
}

function modelOf(parts: Part[]): Model {
  return {
    projectName: 'Doors',
    edgebands: [],
    sheets: [
      { id: 's1', name: 'White 18', code: 'W18', thickness: mm(18), length: mm(2800), width: mm(2070), grain: 'none' },
    ],
    owners: [{ kind: 'cabinet', id: 'c1', label: 'B1' }],
    parts,
  };
}

describe('Flip Parts', () => {
  it('a Part with a blind CNC bottom op is a Flip Part with its own Side B file', () => {
    const result = plan(modelOf([door('d1', [cup(100, 22.5)])]), DEFAULT_SETTINGS);

    expect(result.sideB.map((f) => [f.id, f.partIds])).toEqual([['B1', ['d1']]]);
    expect(result.manualOps).toEqual([]);
  });

  it('a bottom op whose kind is set to manual makes a Manual op, not a Flip Part', () => {
    const settings = { ...DEFAULT_SETTINGS, manualBottomOpKinds: ['drill' as const] };
    const result = plan(modelOf([door('d1', [cup(100, 22.5)])]), settings);

    expect(result.sideB).toEqual([]);
    expect(result.manualOps).toEqual([
      { partId: 'd1', reason: 'manualKind', face: 'bottom', text: 'Drill Ø35 × 13 deep on bottom at x 100, y 22.5' },
    ]);
  });

  it('lists edge-face Manual ops from Import with their Part', () => {
    const part = door('s1', []);
    part.manualOps = [{ reason: 'edge', face: 'x0', text: 'Drill Ø8 × 30 deep on x0 at y 260, z 9' }];

    expect(plan(modelOf([part]), DEFAULT_SETTINGS).manualOps).toEqual([
      { partId: 's1', reason: 'edge', face: 'x0', text: 'Drill Ø8 × 30 deep on x0 at y 260, z 9' },
    ]);
  });
});

describe('Side B orientation', () => {
  /** Where a 700 × 400 door's single op lands in its Side B file, with the edges on the fences. */
  function orient(x: number, y: number) {
    const file = plan(modelOf([door('d1', [cup(x, y)])]), DEFAULT_SETTINGS).sideB[0];
    if (!file) throw new Error('a Side B file');
    const at = sideBPoint(file, { x: mm(x), y: mm(y) });
    return { long: file.longFence, short: file.shortFence, at: [at.x / 1000, at.y / 1000], size: [file.length / 1000, file.width / 1000] };
  }

  it('puts an op near the x0 / y0 corner into the Fence corner', () => {
    // Bottom up with x0 on the long fence and y0 on the short one, (50, 30) lands at (30, 50): no other way is closer.
    expect(orient(50, 30)).toEqual({ long: 'x0', short: 'y0', at: [30, 50], size: [400, 700] });
  });

  it('puts an op near each other corner into the Fence corner', () => {
    expect(orient(650, 30)).toEqual({ long: 'y0', short: 'xL', at: [50, 30], size: [700, 400] });
    expect(orient(50, 370)).toEqual({ long: 'yW', short: 'x0', at: [50, 30], size: [700, 400] });
    expect(orient(650, 370)).toEqual({ long: 'xL', short: 'yW', at: [30, 50], size: [400, 700] });
  });

  it('keeps hinge cups along one long edge on the long fence', () => {
    // Cups 22.5 mm from y0 at both ends: lying along the long fence and standing along the short one tie,
    // and the door's length goes along the long fence.
    const file = plan(modelOf([door('d1', [cup(100, 22.5), cup(600, 22.5)])]), DEFAULT_SETTINGS).sideB[0];

    expect([file?.longFence, file?.shortFence]).toEqual(['y0', 'xL']);
    expect(file?.ops.map((op) => file && op.kind === 'drill' && sideBPoint(file, op.at))).toEqual([
      { x: mm(600), y: mm(22.5) },
      { x: mm(100), y: mm(22.5) },
    ]);
  });
});

describe('Side B files', () => {
  const left = (id: string) => door(id, [cup(100, 22.5), cup(600, 22.5)]);
  const right = (id: string) => door(id, [cup(100, 377.5), cup(600, 377.5)]);

  it('identical doors share one file', () => {
    const result = plan(modelOf([left('d1'), left('d2')]), DEFAULT_SETTINGS);

    expect(result.sideB.map((f) => [f.id, f.partIds])).toEqual([['B1', ['d1', 'd2']]]);
  });

  it('mirrored doors get two files: nothing is turned to make a match', () => {
    const result = plan(modelOf([left('l1'), right('r1'), left('l2'), right('r2')]), DEFAULT_SETTINGS);

    expect(result.sideB.map((f) => f.partIds.slice().sort())).toEqual(
      expect.arrayContaining([
        ['l1', 'l2'],
        ['r1', 'r2'],
      ]),
    );
    expect(result.sideB).toHaveLength(2);
  });

  it('a different cut size gets its own file', () => {
    const result = plan(
      modelOf([left('d1'), door('d2', [cup(100, 22.5), cup(600, 22.5)], { length: 701, width: 400 })]),
      DEFAULT_SETTINGS,
    );

    expect(result.sideB).toHaveLength(2);
  });

  it('numbers files by where their first Part appears in the Run order', () => {
    const result = plan(modelOf([left('l1'), right('r1'), left('l2'), right('r2')]), DEFAULT_SETTINGS);
    const runOrder = result.sheets.flatMap((s) =>
      s.boards.flatMap((b) => b.blanks.flatMap((blank) => blank.parts.map((p) => p.partId))),
    );
    const firstAt = (ids: string[]) => Math.min(...ids.map((id) => runOrder.indexOf(id)));

    expect(result.sideB.map((f) => f.id)).toEqual(['B1', 'B2']);
    expect(firstAt(result.sideB[0]?.partIds ?? [])).toBeLessThan(firstAt(result.sideB[1]?.partIds ?? []));
    for (const file of result.sideB) {
      expect(file.partIds).toEqual([...file.partIds].sort((a, b) => runOrder.indexOf(a) - runOrder.indexOf(b)));
    }
  });
});
