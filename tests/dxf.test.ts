import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDxfFiles } from '../src/core/dxf/index.ts';
import { importExport } from '../src/core/import/index.ts';
import { plan, type Plan } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

const mm = (n: number) => Math.round(n * 1000);

/**
 * A small hand-written Plan: one 600 × 400 mm Blank with a 40 mm clamp margin, one Part as
 * nested and one turned 90°. The golden lists every entity by hand (layer names with `P`
 * decimals, 0.1 mm rounding, groove clipping, the turned Part's transform).
 */
const handPlan: Plan = {
  settings: { ...DEFAULT_SETTINGS, clampMargin: mm(40) },
  sheets: [
    {
      sheetId: 's1',
      code: 'W18',
      thickness: mm(18),
      sawParts: [],
      sawReasons: {},
      unplaced: [],
      boards: [
        {
          number: 1,
          length: mm(2800),
          width: mm(2070),
          sawParts: [],
          offcuts: [],
          cuts: [],
          blanks: [
            {
              id: 'W18-1-A',
              letter: 'A',
              x: 0,
              y: 0,
              length: mm(600),
              width: mm(400),
              parts: [
                {
                  n: 1,
                  partId: 'p1',
                  x: mm(40),
                  y: mm(40),
                  rotated: false,
                  cutLength: mm(200),
                  cutWidth: mm(100),
                  narrow: false,
                  ops: [
                    // Ø4.45 rounds to the 4.5 layer.
                    { kind: 'drill', at: { x: mm(50), y: mm(50) }, diameter: 4450, depth: mm(12.5) },
                    { kind: 'drill', at: { x: mm(150), y: mm(50) }, diameter: mm(5), depth: 'through' },
                    // Runs 10 mm past the Part's xL end: clipped to the cut outline.
                    {
                      kind: 'groove',
                      from: { x: 0, y: mm(20) },
                      to: { x: mm(210), y: mm(20) },
                      width: mm(8.5),
                      depth: mm(8),
                    },
                    {
                      kind: 'pocket',
                      centre: { x: mm(100), y: mm(80) },
                      length: mm(30),
                      width: mm(10),
                      depth: mm(3),
                    },
                  ],
                },
                {
                  n: 2,
                  partId: 'p2',
                  x: mm(300),
                  y: mm(40),
                  rotated: true,
                  cutLength: mm(100),
                  cutWidth: mm(50),
                  narrow: false,
                  ops: [
                    { kind: 'drill', at: { x: mm(10), y: mm(5) }, diameter: mm(8), depth: mm(10) },
                    {
                      kind: 'groove',
                      from: { x: mm(20), y: mm(25) },
                      to: { x: mm(80), y: mm(25) },
                      width: mm(6),
                      depth: mm(5),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('toDxfFiles', () => {
  it('writes one Side A file per Blank, matching the golden R12 output', () => {
    const files = toDxfFiles(handPlan);
    const golden = readFileSync(new URL('golden/W18-1-A.side-a.dxf', import.meta.url), 'utf8');

    expect([...files.keys()]).toEqual(['W18-1-A.side-a.dxf']);
    expect(files.get('W18-1-A.side-a.dxf')).toBe(golden);
  });

  it('gives byte-identical files for the same export, planned twice', () => {
    const run = () => {
      const json: unknown = JSON.parse(
        readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8'),
      );
      const { model } = importExport(json);
      if (!model) throw new Error('synthetic fixture must import');
      return toDxfFiles(plan(model, DEFAULT_SETTINGS));
    };

    const first = run();
    expect([...first.keys()]).toEqual(['W18-1-A.side-a.dxf', 'O16-1-A.side-a.dxf']);
    expect(run()).toEqual(first);
  });
});
