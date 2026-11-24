import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import type { Model, Part } from '../src/core/model.ts';
import { plan, type Blank, type Plan } from '../src/core/planner/index.ts';
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
    for (const board of sheet.boards) {
      // Blanks within the bed and within their Board, with kerf between saw pieces.
      for (const blank of board.blanks) {
        expect(blank.length).toBeLessThanOrEqual(settings.bedLength);
        expect(blank.width).toBeLessThanOrEqual(settings.bedWidth);
        expect(blank.x).toBeGreaterThanOrEqual(0);
        expect(blank.y).toBeGreaterThanOrEqual(0);
        expect(blank.x + blank.length).toBeLessThanOrEqual(board.length);
        expect(blank.y + blank.width).toBeLessThanOrEqual(board.width);
      }
      board.blanks.forEach((a, i) => {
        for (const b of board.blanks.slice(i + 1)) {
          expect(overlaps(a, b, settings.sawKerf), `${a.id} and ${b.id} need kerf between them`).toBe(false);
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

describe('plan', () => {
  it('holds the Planner invariants on the synthetic fixture', () => {
    const model = syntheticModel();
    expectInvariants(model, plan(model, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  });

  it('makes the 2100 mm side a Saw Part and nests the rest', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);

    expect(result.sheets.map((s) => [s.code, s.sawParts])).toEqual([
      ['W18', ['c1/leftSide']],
      ['O16', []],
    ]);
  });

  it('gives Blank ids <Sheet code>-<Board>-<letter> and numbers Parts #1..n', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);

    expect(allBlanks(result).map((b) => b.id)).toEqual(['W18-1-A', 'O16-1-A']);
    expect(allBlanks(result)[0]?.parts.map((p) => p.n)).toEqual([1, 2, 3]);
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

  it.each([1, 2, 3, 4, 5])('holds the invariants on random export %i', (seed) => {
    const model = randomModel(seed, 40);
    expectInvariants(model, plan(model, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
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
    partName: `Panel ${String(i + 1)}`,
    displayName: `R1 · Panel ${String(i + 1)}`,
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
      { id: 's1', name: 'White 18', code: 'W18', thickness: 18000, length: 2800000, width: 2070000, grain: 'none' },
      { id: 's2', name: 'Oak 18', code: 'O18', thickness: 18000, length: 2800000, width: 2070000, grain: 'length' },
    ],
    owners: [{ kind: 'cabinet', id: 'c1', label: 'B1' }],
    parts,
  };
}
