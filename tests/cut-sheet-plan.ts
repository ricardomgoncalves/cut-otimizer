// A hand-written Model and Plan for the cut-sheet tests. Lengths in µm (written as mm through `mm`).
//
// W18 Board 1 (2800 × 2070, edge trim 5, kerf 3.2), front edge at y 5:
//   strip 1, y 5..605:       Blank W18-1-A x 5..1005 | kerf | Saw Part "B1 · Back" x 1008.2..2708.2 | waste 83.6
//   strip 2, y 608.2..1008.2: Blank W18-1-B x 5..1305 | kerf | kept Offcut
//   behind strip 2: kept Offcut y 1011.4..2065
// O16 Board 1 (2440 × 1220, no trim): one strip, Blank O16-1-A 700 × 300, the rest is waste.
import type { Model, Part } from '../src/core/model.ts';
import type { Board, Plan } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

export const mm = (n: number) => Math.round(n * 1000);

function part(p: Partial<Part> & Pick<Part, 'id' | 'displayName' | 'sheetId' | 'cutLength' | 'cutWidth'>): Part {
  return {
    name: p.id,
    partName: p.displayName,
    ownerId: 'c1',
    thickness: p.sheetId === 's1' ? mm(18) : mm(16),
    grain: 'none',
    top: [],
    bottom: [],
    manualOps: [],
    edges: {},
    ...p,
  };
}

export const handModel: Model = {
  projectName: 'Kitchen',
  sheets: [
    { id: 's1', name: 'White melamine 18', code: 'W18', thickness: mm(18), length: mm(2800), width: mm(2070), grain: 'none' },
    { id: 's2', name: 'Oak MDF 16', code: 'O16', thickness: mm(16), length: mm(2440), width: mm(1220), grain: 'length' },
  ],
  edgebands: [{ id: 'e1', name: 'White ABS 1 × 23', thickness: mm(1), width: mm(23) }],
  owners: [
    { kind: 'cabinet', id: 'c1', label: 'B1', cabinetName: 'Base 1 door' },
    { kind: 'generatedItem', id: 'g1', label: 'Toe Kick B1', itemKind: 'toeKick' },
  ],
  parts: [
    part({
      id: 'c1/leftSide',
      displayName: 'B1 · Left side',
      sheetId: 's1',
      cutLength: mm(700),
      cutWidth: mm(520),
      edges: { y0: 'e1' },
      top: [
        { kind: 'drill', at: { x: mm(37), y: mm(100) }, diameter: mm(5), depth: mm(12) },
        { kind: 'drill', at: { x: mm(37), y: mm(132) }, diameter: mm(5), depth: mm(12) },
      ],
    }),
    part({
      id: 'c1/door',
      displayName: 'B1 · Door',
      sheetId: 's1',
      cutLength: mm(300),
      cutWidth: mm(200),
      edges: { x0: 'e1', xL: 'e1', y0: 'e1', yW: 'e1' },
      bottom: [{ kind: 'drill', at: { x: mm(100), y: mm(22.5) }, diameter: mm(35), depth: mm(13) }],
      manualOps: [{ reason: 'edge', face: 'x0', text: 'Drill Ø8 × 30 deep on x0 at y 100, z 9' }],
    }),
    part({ id: 'c1/back', displayName: 'B1 · Back', sheetId: 's1', cutLength: mm(1700), cutWidth: mm(600) }),
    part({
      id: 'c1/shelf',
      displayName: 'B1 · Shelf',
      sheetId: 's1',
      cutLength: mm(1220),
      cutWidth: mm(320),
      top: [{ kind: 'groove', from: { x: mm(0), y: mm(300) }, to: { x: mm(1220), y: mm(300) }, width: mm(8), depth: mm(8) }],
    }),
    part({
      id: 'g1/toeKick',
      displayName: 'Toe Kick B1',
      ownerId: 'g1',
      sheetId: 's2',
      cutLength: mm(620),
      cutWidth: mm(149),
      grain: 'length',
      edges: { y0: 'e1' },
    }),
  ],
};

export const handPlan: Plan = {
  settings: { ...DEFAULT_SETTINGS, edgeTrimBySheet: { s1: mm(5) } },
  sheets: [
    {
      sheetId: 's1',
      code: 'W18',
      thickness: mm(18),
      sawParts: ['c1/back'],
      sawReasons: { 'c1/back': 'chosen' },
      unplaced: [],
      boards: [
        {
          number: 1,
          length: mm(2800),
          width: mm(2070),
          blanks: [
            {
              id: 'W18-1-A',
              letter: 'A',
              x: mm(5),
              y: mm(5),
              length: mm(1000),
              width: mm(600),
              parts: [
                {
                  n: 1,
                  partId: 'c1/leftSide',
                  x: mm(40),
                  y: mm(40),
                  rotated: false,
                  cutLength: mm(700),
                  cutWidth: mm(520),
                  ops: handModelPart('c1/leftSide').top,
                  narrow: false,
                },
                {
                  n: 2,
                  partId: 'c1/door',
                  x: mm(746),
                  y: mm(40),
                  rotated: true,
                  cutLength: mm(300),
                  cutWidth: mm(200),
                  ops: [],
                  narrow: false,
                },
              ],
            },
            {
              id: 'W18-1-B',
              letter: 'B',
              x: mm(5),
              y: mm(608.2),
              length: mm(1300),
              width: mm(400),
              parts: [
                {
                  n: 1,
                  partId: 'c1/shelf',
                  x: mm(40),
                  y: mm(40),
                  rotated: false,
                  cutLength: mm(1220),
                  cutWidth: mm(320),
                  ops: handModelPart('c1/shelf').top,
                  narrow: false,
                },
              ],
            },
          ],
          sawParts: [
            {
              partId: 'c1/back',
              x: mm(1008.2),
              y: mm(5),
              length: mm(1700),
              width: mm(600),
              rotated: false,
              reason: 'chosen',
            },
          ],
          offcuts: [
            { x: mm(2711.4), y: mm(5), length: mm(83.6), width: mm(600), kept: false },
            { id: 'W18-1-K1', x: mm(1308.2), y: mm(608.2), length: mm(1486.8), width: mm(400), kept: true },
            { id: 'W18-1-K2', x: mm(5), y: mm(1011.4), length: mm(2790), width: mm(1053.6), kept: true },
          ],
          cuts: [
            { label: '1', kind: 'rip', x: mm(5), y: mm(605), length: mm(2790) },
            { label: '1a', kind: 'cross', x: mm(1005), y: mm(5), length: mm(600) },
            { label: '1b', kind: 'cross', x: mm(2708.2), y: mm(5), length: mm(600) },
            { label: '2', kind: 'rip', x: mm(5), y: mm(1008.2), length: mm(2790) },
            { label: '2a', kind: 'cross', x: mm(1305), y: mm(608.2), length: mm(400) },
          ],
        },
      ],
    },
    {
      sheetId: 's2',
      code: 'O16',
      thickness: mm(16),
      sawParts: [],
      sawReasons: {},
      unplaced: [],
      boards: [
        {
          number: 1,
          length: mm(2440),
          width: mm(1220),
          blanks: [
            {
              id: 'O16-1-A',
              letter: 'A',
              x: 0,
              y: 0,
              length: mm(700),
              width: mm(229),
              parts: [
                {
                  n: 1,
                  partId: 'g1/toeKick',
                  x: mm(40),
                  y: mm(40),
                  rotated: false,
                  cutLength: mm(620),
                  cutWidth: mm(149),
                  ops: [],
                  narrow: false,
                },
              ],
            },
          ],
          sawParts: [],
          offcuts: [
            { id: 'O16-1-K1', x: mm(703.2), y: 0, length: mm(1736.8), width: mm(229), kept: true },
            { id: 'O16-1-K2', x: 0, y: mm(232.2), length: mm(2440), width: mm(987.8), kept: true },
          ],
          cuts: [
            { label: '1', kind: 'rip', x: 0, y: mm(229), length: mm(2440) },
            { label: '1a', kind: 'cross', x: mm(700), y: 0, length: mm(229) },
          ],
        },
      ],
    },
  ],
  sideB: [
    {
      id: 'B1',
      turns: 0,
      longFence: 'yW',
      shortFence: 'x0',
      cutLength: mm(300),
      cutWidth: mm(200),
      length: mm(300),
      width: mm(200),
      ops: handModelPart('c1/door').bottom,
      partIds: ['c1/door'],
    },
  ],
  manualOps: [{ partId: 'c1/door', reason: 'edge', face: 'x0', text: 'Drill Ø8 × 30 deep on x0 at y 100, z 9' }],
};

function handModelPart(id: string): Part {
  const p = handModel.parts.find((q) => q.id === id);
  if (!p) throw new Error(id);
  return p;
}

/**
 * W18 Board 1 of `handPlan` after the door was remade and nested again on kept Offcut K1 (Board Locked):
 * K1 (x 1308.2..2795, y 608.2..1008.2) gives rip K1.1 at y 908.2 and crosscut K1.1a at x 2008.2 = Blank
 * W18-1-C (700 × 300); left over: K3 (783.6 × 300, kept) beside it and 1486.8 × 96.8 of waste behind.
 */
export function offcutBoard(): Board {
  const board = handPlan.sheets[0]?.boards[0];
  const door = board?.blanks[0]?.parts.find((p) => p.partId === 'c1/door');
  if (!board || !door) throw new Error('handPlan changed');
  return {
    ...board,
    blanks: [
      ...board.blanks.map((b) => ({ ...b, parts: b.parts.map((p) => (p.partId === 'c1/door' ? { ...p, remade: true } : p)) })),
      {
        id: 'W18-1-C',
        letter: 'C',
        x: mm(1308.2),
        y: mm(608.2),
        length: mm(700),
        width: mm(300),
        from: 'W18-1-K1',
        clampMargin: mm(40),
        parts: [{ ...door, n: 1, x: mm(40), y: mm(40), rotated: false }],
      },
    ],
    offcuts: [
      ...board.offcuts.map((o) => (o.id === 'W18-1-K1' ? { ...o, used: true } : o.id === 'W18-1-K2' ? { ...o, discarded: true } : o)),
      { id: 'W18-1-K3', x: mm(2011.4), y: mm(608.2), length: mm(783.6), width: mm(300), kept: true },
      { x: mm(1308.2), y: mm(911.4), length: mm(1486.8), width: mm(96.8), kept: false },
    ],
    cuts: [
      ...board.cuts,
      { label: 'K1.1', kind: 'rip', x: mm(1308.2), y: mm(908.2), length: mm(1486.8), from: 'W18-1-K1' },
      { label: 'K1.1a', kind: 'cross', x: mm(2008.2), y: mm(608.2), length: mm(300), from: 'W18-1-K1' },
    ],
  };
}
