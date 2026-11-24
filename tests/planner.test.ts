import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import type { Model, Part } from '../src/core/model.ts';
import { partRule, plan, type Blank, type Plan } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';

function syntheticModel(): Model {
  const json: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8'),
  );
  const { model } = importExport(json);
  if (!model) throw new Error('synthetic fixture must import');
  return model;
}

interface Rect {
  x: number;
  y: number;
  length: number;
  width: number;
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.length + gap &&
  b.x < a.x + a.length + gap &&
  a.y < b.y + b.width + gap &&
  b.y < a.y + a.width + gap;

const footprints = (blank: Blank): (Rect & { partId: string })[] =>
  blank.parts.map((p) => ({
    partId: p.partId,
    x: p.x,
    y: p.y,
    length: p.rotated ? p.cutWidth : p.cutLength,
    width: p.rotated ? p.cutLength : p.cutWidth,
  }));

const allBlanks = (result: Plan) => result.sheets.flatMap((s) => s.boards.flatMap((b) => b.blanks));

/** The Planner invariants every Plan must hold. */
function expectInvariants(model: Model, result: Plan, settings: Settings) {
  const clamp = settings.clampMargin;

  // Every Part placed exactly once, as a CNC Part or a Saw Part.
  const placed = [
    ...allBlanks(result).flatMap((b) => b.parts.map((p) => p.partId)),
    ...result.sheets.flatMap((s) => s.sawParts),
  ].sort();
  expect(placed).toEqual(model.parts.map((p) => p.id).sort());

  for (const sheet of result.sheets) {
    // Each Saw Part is on exactly one Board (or too big for any Board of its Sheet).
    const sawn = [...sheet.boards.flatMap((b) => b.sawParts.map((p) => p.partId)), ...sheet.unplaced].sort();
    expect(sawn).toEqual([...sheet.sawParts].sort());
    // Every Saw Part piece has the Part's size.
    for (const board of sheet.boards) {
      for (const p of board.sawParts) {
        const part = model.parts.find((q) => q.id === p.partId);
        expect([p.length, p.width]).toEqual(
          p.rotated ? [part?.cutWidth, part?.cutLength] : [part?.cutLength, part?.cutWidth],
        );
      }
    }
  }

  for (const sheet of result.sheets) {
    for (const board of sheet.boards) {
      const trim = settings.edgeTrimBySheet[sheet.sheetId] ?? settings.edgeTrim;
      // Blanks within the bed; every saw piece within the trimmed Board, with kerf between saw pieces.
      for (const blank of board.blanks) {
        expect(blank.length).toBeLessThanOrEqual(settings.bedLength);
        expect(blank.width).toBeLessThanOrEqual(settings.bedWidth);
      }
      const pieces: (Rect & { name: string })[] = [
        ...board.blanks.map((b) => ({ ...b, name: b.id })),
        ...board.sawParts.map((p) => ({ ...p, name: p.partId })),
        ...board.offcuts.map((o, i) => ({ ...o, name: `offcut ${String(i)}` })),
      ];
      for (const r of pieces) {
        expect(r.x, r.name).toBeGreaterThanOrEqual(trim);
        expect(r.y, r.name).toBeGreaterThanOrEqual(trim);
        expect(r.x + r.length, r.name).toBeLessThanOrEqual(board.length - trim);
        expect(r.y + r.width, r.name).toBeLessThanOrEqual(board.width - trim);
      }
      pieces.forEach((a, i) => {
        for (const b of pieces.slice(i + 1)) {
          expect(overlaps(a, b, settings.sawKerf), `${a.name} and ${b.name} need kerf between them`).toBe(
            false,
          );
        }
      });

      for (const blank of board.blanks) {
        const rects = footprints(blank);
        // Parts inside the Blank minus the clamp margin on all four edges.
        for (const r of rects) {
          expect(r.x, r.partId).toBeGreaterThanOrEqual(clamp);
          expect(r.y, r.partId).toBeGreaterThanOrEqual(clamp);
          expect(r.x + r.length, r.partId).toBeLessThanOrEqual(blank.length - clamp);
          expect(r.y + r.width, r.partId).toBeLessThanOrEqual(blank.width - clamp);
        }
        // Narrow Parts on the CNC are flagged.
        for (const p of blank.parts) {
          expect(p.narrow, p.partId).toBe(Math.min(p.cutLength, p.cutWidth) < settings.minCncWidth);
        }
        // No overlaps, with room for the bit between Parts.
        rects.forEach((a, i) => {
          for (const b of rects.slice(i + 1)) {
            expect(overlaps(a, b, settings.bitDiameter), `${a.partId} overlaps ${b.partId}`).toBe(false);
          }
        });
      }
    }
  }
}

/** The Run order rules every Plan must hold. */
function expectRunOrder(model: Model, result: Plan) {
  // Sheets grouped by thickness; groups and Sheets within them in export order.
  const thicknesses = [...new Set(model.sheets.map((s) => s.thickness))];
  const expected = thicknesses.flatMap((t) => model.sheets.filter((s) => s.thickness === t).map((s) => s.id));
  expect(result.sheets.map((s) => s.sheetId)).toEqual(expected);

  for (const sheet of result.sheets) {
    expect(sheet.boards.map((b) => b.number)).toEqual(sheet.boards.map((_, i) => i + 1));
    for (const board of sheet.boards) {
      // Letters A, B, ... in saw order: strip by strip from the front, left to right in a strip.
      expect(board.blanks.map((b) => b.id)).toEqual(
        board.blanks.map((_, i) => `${sheet.code}-${String(board.number)}-${String.fromCharCode(65 + i)}`),
      );
      board.blanks.slice(1).forEach((b, i) => {
        const prev = board.blanks[i];
        if (!prev) return;
        expect(
          prev.y < b.y || (prev.y === b.y && prev.x < b.x),
          `${b.id} comes off the saw after ${prev.id}`,
        ).toBe(true);
      });
      for (const blank of board.blanks) {
        expect(blank.parts.map((p) => p.n)).toEqual(blank.parts.map((_, i) => i + 1));
        blank.parts.slice(1).forEach((p, i) => {
          const prev = blank.parts[i];
          if (!prev) return;
          expect(prev.y < p.y || (prev.y === p.y && prev.x < p.x), `${blank.id} #${String(p.n)}`).toBe(true);
        });
      }
    }
  }
}

describe('plan', () => {
  it('holds the Planner invariants on the synthetic fixture', () => {
    const model = syntheticModel();
    expectInvariants(model, plan(model, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  });

  it('makes the 2100 mm side and the narrow op-less rail Saw Parts, and nests the rest', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);

    expect(result.sheets.map((s) => [s.code, s.sawParts])).toEqual([
      ['W18', ['c1/leftSide', 'c1/s0.rail[1]']],
      ['O16', []],
    ]);
    expect(result.sheets[0]?.sawReasons).toEqual({ 'c1/leftSide': 'oversize', 'c1/s0.rail[1]': 'narrow' });
  });

  it('gives Blank ids <Sheet code>-<Board>-<letter> and numbers Parts #1..n', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);

    expect(allBlanks(result).map((b) => b.id)).toEqual(['W18-1-A', 'O16-1-A']);
    expect(allBlanks(result)[0]?.parts.map((p) => p.n)).toEqual([1, 2]);
  });

  it('never rotates a grained Part', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);
    const toeKick = allBlanks(result)
      .flatMap((b) => b.parts)
      .find((p) => p.partId === 'w1.left.lower.c1/toeKick/0');

    expect(toeKick?.rotated).toBe(false);
  });

  it('carries only top-face ops onto Side A', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);
    const door = allBlanks(result)
      .flatMap((b) => b.parts)
      .find((p) => p.partId === 'c1/s0.door.leaf[0]');

    expect(door?.ops).toEqual([]);
  });

  it('numbers Parts by position: front row left to right, then the next row back', () => {
    const result = plan(randomModel(7, 30), DEFAULT_SETTINGS);
    for (const blank of allBlanks(result)) {
      const ordered = [...blank.parts].sort((a, b) => a.n - b.n);
      ordered.slice(1).forEach((p, i) => {
        const prev = ordered[i];
        if (!prev) return;
        expect(prev.y < p.y || (prev.y === p.y && prev.x < p.x), `${blank.id} #${String(p.n)}`).toBe(true);
      });
    }
  });

  it('is deterministic', () => {
    const model = syntheticModel();
    expect(plan(model, DEFAULT_SETTINGS)).toEqual(plan(model, DEFAULT_SETTINGS));
  });

  it('reads the clamp margin from its settings: a wider margin changes the Layout and the invariants hold', () => {
    const model = randomModel(3, 40);
    const wide: Settings = { ...DEFAULT_SETTINGS, clampMargin: 120000 };
    const before = plan(model, DEFAULT_SETTINGS);
    const after = plan(model, wide);

    expectInvariants(model, after, wide);
    expect(after.settings).toEqual(wide);
    const first = (p: Plan) => allBlanks(p)[0]?.parts.map((q) => [q.partId, q.x, q.y]);
    expect(first(after)).not.toEqual(first(before));
    // Every Part on the first Blank now sits at least 120 mm in from its edges.
    for (const p of allBlanks(after)[0]?.parts ?? []) {
      expect(Math.min(p.x, p.y)).toBeGreaterThanOrEqual(120000);
    }
  });

  it('trims every Board edge by the Sheet edge trim before breaking it down', () => {
    const model = randomModel(2, 40);
    const settings: Settings = { ...DEFAULT_SETTINGS, edgeTrim: 10000, edgeTrimBySheet: { s2: 25000 } };
    const result = plan(model, settings);

    expectInvariants(model, result, settings);
    for (const sheet of result.sheets) {
      const trim = sheet.sheetId === 's2' ? 25000 : 10000;
      for (const board of sheet.boards) {
        for (const blank of board.blanks) {
          expect(blank.x, blank.id).toBeGreaterThanOrEqual(trim);
          expect(blank.y, blank.id).toBeGreaterThanOrEqual(trim);
          expect(blank.x + blank.length, blank.id).toBeLessThanOrEqual(board.length - trim);
          expect(blank.y + blank.width, blank.id).toBeLessThanOrEqual(board.width - trim);
        }
      }
    }
    // The first Blank of each Sheet starts at the trimmed corner.
    expect(result.sheets.map((s) => [s.boards[0]?.blanks[0]?.x, s.boards[0]?.blanks[0]?.y])).toEqual([
      [10000, 10000],
      [25000, 25000],
    ]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'holds the invariants and Run order on random export %i',
    (seed) => {
      const model = randomModel(seed, 40);
      const result = plan(model, DEFAULT_SETTINGS);
      expectInvariants(model, result, DEFAULT_SETTINGS);
      expectRunOrder(model, result);
    },
  );

  it('nests a narrow op-less Part toggled to CNC, flagged narrow', () => {
    const model = syntheticModel();
    const result = plan(model, DEFAULT_SETTINGS, { sawCnc: { 'c1/s0.rail[1]': 'cnc' } });

    expectInvariants(model, result, DEFAULT_SETTINGS);
    expect(result.sheets[0]?.sawParts).toEqual(['c1/leftSide']);
    const rail = allBlanks(result)
      .flatMap((b) => b.parts)
      .find((p) => p.partId === 'c1/s0.rail[1]');
    expect(rail?.narrow).toBe(true);
  });

  it('makes any Part a Saw Part by hand, but never sends a Part bigger than the bed to the CNC', () => {
    const model = syntheticModel();
    const result = plan(model, DEFAULT_SETTINGS, {
      sawCnc: { 'c1/s0.shelf[0]': 'saw', 'c1/leftSide': 'cnc' },
    });

    expectInvariants(model, result, DEFAULT_SETTINGS);
    expect(result.sheets[0]?.sawReasons).toEqual({
      'c1/leftSide': 'oversize',
      'c1/s0.shelf[0]': 'chosen',
      'c1/s0.rail[1]': 'narrow',
    });
  });

  it('keeps a narrow Part with CNC ops on the CNC, with a warning', () => {
    const model = syntheticModel();
    model.parts = model.parts.map((p) =>
      p.id === 'c1/s0.rail[1]'
        ? { ...p, top: [{ kind: 'drill', at: { x: 20000, y: 20000 }, diameter: 5000, depth: 10000 }] }
        : p,
    );
    const result = plan(model, DEFAULT_SETTINGS);

    expect(result.sheets[0]?.sawParts).toEqual(['c1/leftSide']);
    expect(
      allBlanks(result)
        .flatMap((b) => b.parts)
        .find((p) => p.partId === 'c1/s0.rail[1]')?.narrow,
    ).toBe(true);
    expect(partRule(model, DEFAULT_SETTINGS, 'c1/s0.rail[1]')).toEqual({
      auto: 'cnc',
      oversize: false,
      narrow: true,
      hasCncOps: true,
    });
  });

  it('holds the Run order on the synthetic fixture', () => {
    const model = syntheticModel();
    expectRunOrder(model, plan(model, DEFAULT_SETTINGS));
  });

  it('groups Sheets by thickness, in export order', () => {
    const model = randomModel(4, 30);
    model.sheets = [
      {
        id: 'a',
        name: 'A 18',
        code: 'A18',
        thickness: 18000,
        length: 2800000,
        width: 2070000,
        grain: 'none',
      },
      {
        id: 'b',
        name: 'B 16',
        code: 'B16',
        thickness: 16000,
        length: 2800000,
        width: 2070000,
        grain: 'none',
      },
      {
        id: 'c',
        name: 'C 18',
        code: 'C18',
        thickness: 18000,
        length: 2800000,
        width: 2070000,
        grain: 'none',
      },
    ];
    model.parts = model.parts.map((p, i) => ({ ...p, sheetId: ['a', 'b', 'c'][i % 3] ?? 'a' }));

    expect(plan(model, DEFAULT_SETTINGS).sheets.map((s) => s.code)).toEqual(['A18', 'C18', 'B16']);
  });

  it('places Saw Parts in the Breakdown and numbers rips 1, 2… and crosscuts 1a, 1b…', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);
    const board = result.sheets[0]?.boards[0];

    expect(board?.sawParts.map((p) => p.partId).sort()).toEqual(['c1/leftSide', 'c1/s0.rail[1]']);
    const labels = board?.cuts.map((c) => c.label) ?? [];
    expect(labels.length).toBeGreaterThan(0);
    for (const cut of board?.cuts ?? []) {
      expect(cut.label).toMatch(cut.kind === 'rip' ? /^[0-9]+$/ : /^[0-9]+[a-z]+$/);
    }
    expect(labels.filter((l) => /^[0-9]+$/.test(l))).toEqual(
      labels.filter((l) => /^[0-9]+$/.test(l)).map((_, i) => String(i + 1)),
    );
  });

  it('shrinks a Blank to what its Layout uses, leaving one large Offcut', () => {
    const model = randomModel(1, 1);
    model.parts = [{ ...(model.parts[0] as Part), cutLength: 400000, cutWidth: 300000, grain: 'length' }];
    const board = plan(model, DEFAULT_SETTINGS).sheets[0]?.boards[0];

    // 400 × 300 plus the 40 mm clamp margin on each side.
    expect(board?.blanks.map((b) => [b.x, b.y, b.length, b.width])).toEqual([[0, 0, 480000, 380000]]);
    expect(board?.offcuts).toEqual([
      { x: 483200, y: 0, length: 2800000 - 483200, width: 380000, kept: true },
      { x: 0, y: 383200, length: 2800000, width: 2070000 - 383200, kept: true },
    ]);
    expect(board?.cuts).toEqual([
      { label: '1', kind: 'rip', x: 0, y: 380000, length: 2800000 },
      { label: '1a', kind: 'cross', x: 480000, y: 0, length: 380000 },
    ]);
  });

  it('prefers fewer Blanks when the same Part area is placed', () => {
    // Two Parts that fit one bed-sized Blank together go on one Blank, not two.
    const model = randomModel(1, 2);
    model.parts = model.parts.map((p) => ({
      ...p,
      sheetId: 's1',
      cutLength: 600000,
      cutWidth: 500000,
      grain: 'length' as const,
    }));
    const sheet = plan(model, DEFAULT_SETTINGS).sheets[0];

    expect(sheet?.boards.flatMap((b) => b.blanks).map((b) => b.parts.length)).toEqual([2]);
  });

  it('marks Offcuts kept only when at least Min Offcut size on both sides', () => {
    const model = randomModel(1, 1);
    model.parts = [{ ...(model.parts[0] as Part), cutLength: 1220000, cutWidth: 300000, grain: 'length' }];
    const board = plan(model, { ...DEFAULT_SETTINGS, minOffcutSize: 1500000 }).sheets[0]?.boards[0];

    // 1496.8 × 380 beside the Blank is waste; 2800 × 1686.8 behind it is kept.
    expect(board?.offcuts.map((o) => [o.length, o.width, o.kept])).toEqual([
      [1496800, 380000, false],
      [2800000, 1686800, true],
    ]);
  });
});

/** A small seeded PRNG (mulberry32) so random exports are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomModel(seed: number, count: number): Model {
  const random = rng(seed);
  const between = (lo: number, hi: number) => Math.round(lo + random() * (hi - lo)) * 1000;
  const parts: Part[] = Array.from({ length: count }, (_, i) => ({
    id: `p${String(i)}`,
    name: 'panel',
    ownerId: 'c1',
    sheetId: random() < 0.7 ? 's1' : 's2',
    thickness: 18000,
    cutLength: between(60, 2400),
    cutWidth: between(40, 900),
    grain: random() < 0.5 ? 'length' : 'none',
    top: [],
    bottom: [],
    edgeOps: [],
  }));
  return {
    projectName: 'Random',
    sheets: [
      {
        id: 's1',
        name: 'White 18',
        code: 'W18',
        thickness: 18000,
        length: 2800000,
        width: 2070000,
        grain: 'none',
      },
      {
        id: 's2',
        name: 'Oak 18',
        code: 'O18',
        thickness: 18000,
        length: 2800000,
        width: 2070000,
        grain: 'length',
      },
    ],
    owners: [{ kind: 'cabinet', id: 'c1', label: 'B1' }],
    parts,
  };
}
