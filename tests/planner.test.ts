import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import type { Model, Part } from '../src/core/model.ts';
import { discardOffcut, remakePart } from '../src/core/plan-queries.ts';
import {
  partRule,
  plan,
  type Blank,
  type Board,
  type Plan,
} from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';

/** The settings from before tiling: a Part longer than the bed is always a Saw Part. */
const NO_TILING: Settings = { ...DEFAULT_SETTINGS, allowTiling: false };

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
function expectInvariants(
  model: Model,
  result: Plan,
  planSettings: Settings,
  locked?: { settings: Settings; boards: Set<string>; blanks: Set<string> },
) {

  // Every Part placed exactly once, as a CNC Part or a Saw Part, or waiting for a Board. A Remake Part
  // also stays greyed (remade) where it was cut before.
  const placed = [
    ...allBlanks(result).flatMap((b) => b.parts.filter((p) => !p.remade).map((p) => p.partId)),
    ...result.sheets.flatMap((s) => s.sawParts),
    ...result.sheets.flatMap((s) => (s.overflow ?? []).filter((id) => !s.sawParts.includes(id))),
  ].sort();
  expect(placed).toEqual(model.parts.map((p) => p.id).sort());

  for (const sheet of result.sheets) {
    // Each Saw Part is on exactly one Board (or too big for any Board of its Sheet, or waiting for a Board).
    const sawn = [
      ...sheet.boards.flatMap((b) => b.sawParts.filter((p) => !p.remade).map((p) => p.partId)),
      ...sheet.unplaced,
      ...(sheet.overflow ?? []).filter((id) => sheet.sawParts.includes(id)),
    ].sort();
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
      // A Locked Board was planned with the earlier settings and is kept as it was.
      // A Locked Board keeps the Breakdown it was planned with, and a Locked Blank its Layout; an unlocked
      // Blank on a Locked Board keeps its outline but is nested again with the new settings.
      const settings = locked?.boards.has(`${sheet.sheetId}/${String(board.number)}`) ? locked.settings : planSettings;
      const trim = settings.edgeTrimBySheet[sheet.sheetId] ?? settings.edgeTrim;
      // Blanks within the bed, except a Tiled Blank: longer than the bed along X only, to hold a Part
      // longer than the usable bed. Every saw piece within the trimmed Board, with kerf between saw pieces.
      for (const blank of board.blanks) {
        expect(blank.width, blank.id).toBeLessThanOrEqual(settings.bedWidth);
        if (!blank.tiled) {
          expect(blank.length, blank.id).toBeLessThanOrEqual(settings.bedLength);
          continue;
        }
        expect(settings.allowTiling, blank.id).toBe(true);
        expect(blank.length, blank.id).toBeGreaterThan(settings.bedLength);
        const usableL = settings.bedLength - 2 * (blank.clampMargin ?? settings.clampMargin);
        expect(footprints(blank).some((r) => r.length > usableL), `${blank.id} holds a Part longer than the bed`).toBe(true);
      }
      const pieces: (Rect & { name: string })[] = [
        ...board.blanks.map((b) => ({ ...b, name: b.id })),
        ...board.sawParts.map((p) => ({ ...p, name: p.partId })),
        ...board.offcuts.map((o, i) => ({ ...o, name: o.id ?? `offcut ${String(i)}` })),
      ];
      // A kept Offcut cut up later holds its new Blanks and leftovers, each wholly inside it.
      const used = board.offcuts.filter((o) => o.used);
      const parentOf = (r: Rect & { name: string }) =>
        used.find(
          (o) =>
            o.id !== r.name &&
            r.x >= o.x &&
            r.y >= o.y &&
            r.x + r.length <= o.x + o.length &&
            r.y + r.width <= o.y + o.width,
        );
      for (const blank of board.blanks.filter((b) => b.from)) {
        expect(parentOf({ ...blank, name: blank.id })?.id, blank.id).toBe(blank.from);
      }
      const contains = (o: Rect & { name: string }, r: Rect & { name: string }) =>
        used.some((u) => u.id === o.name) &&
        r.x >= o.x &&
        r.y >= o.y &&
        r.x + r.length <= o.x + o.length &&
        r.y + r.width <= o.y + o.width;
      for (const r of pieces) {
        expect(r.x, r.name).toBeGreaterThanOrEqual(trim);
        expect(r.y, r.name).toBeGreaterThanOrEqual(trim);
        expect(r.x + r.length, r.name).toBeLessThanOrEqual(board.length - trim);
        expect(r.y + r.width, r.name).toBeLessThanOrEqual(board.width - trim);
      }
      pieces.forEach((a, i) => {
        for (const b of pieces.slice(i + 1)) {
          if (contains(a, b) || contains(b, a)) continue;
          expect(overlaps(a, b, settings.sawKerf), `${a.name} and ${b.name} need kerf between them`).toBe(
            false,
          );
        }
      });

      for (const blank of board.blanks) {
        const nested = locked?.blanks.has(blank.id) ? locked.settings : planSettings;
        const clamp = nested.clampMargin;
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
          expect(p.narrow, p.partId).toBe(Math.min(p.cutLength, p.cutWidth) < nested.minCncWidth);
        }
        // No overlaps, with room for the bit between Parts.
        rects.forEach((a, i) => {
          for (const b of rects.slice(i + 1)) {
            expect(overlaps(a, b, nested.bitDiameter), `${a.partId} overlaps ${b.partId}`).toBe(false);
          }
        });
      }
    }
  }
}

/** The Run order rules every Plan must hold. */
function expectRunOrder(model: Model, result: Plan, locked = new Set<string>()) {
  // Sheets grouped by thickness; groups and Sheets within them in export order.
  const thicknesses = [...new Set(model.sheets.map((s) => s.thickness))];
  const expected = thicknesses.flatMap((t) => model.sheets.filter((s) => s.thickness === t).map((s) => s.id));
  expect(result.sheets.map((s) => s.sheetId)).toEqual(expected);

  for (const sheet of result.sheets) {
    // Locked Boards keep their numbers and come first; new Boards take the next free numbers after them.
    const isLocked = (n: number) => locked.has(`${sheet.sheetId}/${String(n)}`);
    const numbers = sheet.boards.map((b) => b.number);
    const lockedNumbers = numbers.filter(isLocked);
    const last = Math.max(0, ...lockedNumbers);
    expect(numbers).toEqual([
      ...[...lockedNumbers].sort((a, b) => a - b),
      ...numbers.filter((n) => !isLocked(n)).map((_, i) => last + i + 1),
    ]);
    for (const board of sheet.boards) {
      // Letters A, B, ... in saw order: strip by strip from the front, left to right in a strip.
      expect(board.blanks.map((b) => b.id)).toEqual(
        board.blanks.map((_, i) => `${sheet.code}-${String(board.number)}-${String.fromCharCode(65 + i)}`),
      );
      board.blanks.slice(1).forEach((b, i) => {
        const prev = board.blanks[i];
        // Blanks cut from a kept Offcut come after the Board's own, in saw order within that Offcut.
        if (!prev || prev.from !== b.from) return;
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
    const result = plan(syntheticModel(), NO_TILING);

    expect(result.sheets.map((s) => [s.code, s.sawParts])).toEqual([
      ['W18', ['c1/leftSide', 'c1/s0.rail[1]']],
      ['O16', []],
    ]);
    expect(result.sheets[0]?.sawReasons).toEqual({ 'c1/leftSide': 'oversize', 'c1/s0.rail[1]': 'narrow' });
  });

  it('makes the op-less 2100 mm side a Saw Part longer than the bed when tiling is on', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);
    expect(result.sheets[0]?.sawReasons).toEqual({ 'c1/leftSide': 'long', 'c1/s0.rail[1]': 'narrow' });
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

  it('carries top-face ops onto Side A, with the through bottom drill mirrored and the blind cup left for Side B', () => {
    const result = plan(syntheticModel(), DEFAULT_SETTINGS);
    const door = allBlanks(result)
      .flatMap((b) => b.parts)
      .find((p) => p.partId === 'c1/s0.door.leaf[0]');

    expect(door?.ops).toEqual([{ kind: 'drill', at: { x: 649000, y: 559000 }, diameter: 5000, depth: 'through' }]);
    expect(result.sideB.map((f) => [f.id, f.partIds, f.ops.length])).toEqual([['B1', ['c1/s0.door.leaf[0]'], 1]]);
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
    const result = plan(model, NO_TILING, {
      sawCnc: { 'c1/s0.shelf[0]': 'saw', 'c1/leftSide': 'cnc' },
    });

    expectInvariants(model, result, NO_TILING);
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
      tileable: false,
      narrow: true,
      hasCncOps: true,
    });
  });

  // Every Parts Export in fixtures/ (the synthetic one, and the real one once it is added).
  it.each(readdirSync(new URL('../fixtures/', import.meta.url)).filter((f) => f.endsWith('.json')))(
    'holds the invariants and Run order on fixtures/%s',
    (file) => {
      const json: unknown = JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));
      const { model } = importExport(json);
      if (!model) throw new Error(`${file} must import`);
      const result = plan(model, DEFAULT_SETTINGS);
      expectInvariants(model, result, DEFAULT_SETTINGS);
      expectRunOrder(model, result);
    },
  );

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
      { id: 'W18-1-K1', x: 483200, y: 0, length: 2800000 - 483200, width: 380000, kept: true },
      { id: 'W18-1-K2', x: 0, y: 383200, length: 2800000, width: 2070000 - 383200, kept: true },
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
    expect(board?.offcuts.map((o) => [o.id, o.length, o.width, o.kept])).toEqual([
      [undefined, 1496800, 380000, false],
      ['W18-1-K1', 2800000, 1686800, true],
    ]);
  });
});

describe('Locked Boards and Blanks', () => {
  const changed: Settings = {
    ...DEFAULT_SETTINGS,
    clampMargin: 55000,
    bitDiameter: 8000,
    sawKerf: 4000,
    edgeTrim: 10000,
    minCncWidth: 70000,
    bedLength: 1250000,
  };

  const outline = (b: Blank) => ({ id: b.id, letter: b.letter, x: b.x, y: b.y, length: b.length, width: b.width, from: b.from });
  const boardParts = (b: Board) => [...b.blanks.flatMap((x) => x.parts.map((p) => p.partId)), ...b.sawParts.map((p) => p.partId)];

  /** Ticks Cut on a seeded sample of the Parts on Boards. */
  function tickSome(result: Plan, seed: number): string[] {
    const random = rng(seed * 31);
    return result.sheets.flatMap((s) => s.boards.flatMap(boardParts)).filter(() => random() < 0.15);
  }

  const lockedBoards = (result: Plan, cut: readonly string[]) =>
    result.sheets.flatMap((sheet) =>
      sheet.boards
        .filter((b) => boardParts(b).some((id) => cut.includes(id)))
        .map((board) => ({ sheetId: sheet.sheetId, board })),
    );

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'keeps every Locked Board and Blank unchanged after regenerating with changed settings (random export %i)',
    (seed) => {
      const model = randomModel(seed, 40);
      const before = plan(model, DEFAULT_SETTINGS);
      const cut = tickSome(before, seed);
      const locked = lockedBoards(before, cut);
      const after = plan(model, changed, { plan: before, cut });

      const lockedBlanks = new Set<string>();
      for (const { sheetId, board } of locked) {
        const kept = after.sheets.find((s) => s.sheetId === sheetId)?.boards.find((b) => b.number === board.number);
        // The Breakdown stays: Board number, Blank outlines and ids, Saw Parts, Offcuts and cuts.
        expect({ ...kept, blanks: kept?.blanks.map(outline) }).toEqual({ ...board, blanks: board.blanks.map(outline) });
        // A Blank with a Part ticked Cut stays exactly as it was.
        for (const blank of board.blanks.filter((b) => b.parts.some((p) => cut.includes(p.partId)))) {
          lockedBlanks.add(blank.id);
          expect(kept?.blanks.find((b) => b.id === blank.id)).toEqual(blank);
        }
      }
      const lockedKeys = new Set(locked.map((l) => `${l.sheetId}/${String(l.board.number)}`));
      expectInvariants(model, after, changed, { settings: DEFAULT_SETTINGS, boards: lockedKeys, blanks: lockedBlanks });
      expectRunOrder(model, after, lockedKeys);
    },
  );

  it('gives new Boards the next free numbers, so new Blanks never reuse a Locked id and sort last', () => {
    const model = randomModel(5, 60);
    const before = plan(model, DEFAULT_SETTINGS);
    const first = before.sheets[0]?.boards[0];
    const partId = first?.blanks[0]?.parts[0]?.partId;
    if (!first || !partId) throw new Error('needs a W18 Blank');
    const after = plan(model, changed, { plan: before, cut: [partId] });
    const sheet = after.sheets[0];

    expect(sheet?.boards[0]?.blanks[0]).toEqual(first.blanks[0]);
    expect(sheet?.boards[0]?.blanks.map(outline)).toEqual(first.blanks.map(outline));
    const lockedIds = new Set(first.blanks.map((b) => b.id));
    const newBoards = sheet?.boards.slice(1) ?? [];
    expect(newBoards.length).toBeGreaterThan(0);
    for (const board of newBoards) {
      expect(board.number).toBeGreaterThan(first.number);
      for (const blank of board.blanks) expect(lockedIds.has(blank.id), blank.id).toBe(false);
    }
  });

  it('numbers new Boards after the highest Locked Board, even when an earlier Board is unlocked', () => {
    const model = randomModel(5, 60);
    const before = plan(model, DEFAULT_SETTINGS);
    const second = before.sheets[0]?.boards[1];
    const partId = second ? boardParts(second)[0] : undefined;
    if (!second || !partId) throw new Error('needs two W18 Boards');
    const sheet = plan(model, DEFAULT_SETTINGS, { plan: before, cut: [partId] }).sheets[0];

    expect(sheet?.boards[0]).toEqual(second);
    expect(sheet?.boards.slice(1).map((b) => b.number)).toEqual(
      sheet?.boards.slice(1).map((_, i) => second.number + i + 1),
    );
  });

  it('plans from scratch when nothing is ticked Cut', () => {
    const model = randomModel(3, 40);
    const before = plan(model, DEFAULT_SETTINGS);
    expect(plan(model, changed, { plan: before, cut: [] })).toEqual(plan(model, changed));
  });

  it('keeps a Locked Saw Part where it is, with its reason, and re-plans the other Sheet', () => {
    const model = syntheticModel();
    const before = plan(model, DEFAULT_SETTINGS);
    const after = plan(model, changed, { plan: before, cut: ['c1/leftSide'], sawCnc: { 'c1/s0.rail[1]': 'cnc' } });

    const [kept] = after.sheets[0]?.boards ?? [];
    const [old] = before.sheets[0]?.boards ?? [];
    expect(kept?.sawParts).toEqual(old?.sawParts);
    expect(kept?.cuts).toEqual(old?.cuts);
    expect(kept?.blanks.map(outline)).toEqual(old?.blanks.map(outline));
    expect(after.sheets[0]?.sawParts).toEqual(before.sheets[0]?.sawParts);
    expect(after.sheets[0]?.sawReasons).toEqual(before.sheets[0]?.sawReasons);
    expect(after.sheets[1]?.boards[0]).not.toEqual(before.sheets[1]?.boards[0]);
  });

  it('keeps a Locked Board’s Breakdown but nests its uncut Blanks again, inside their outlines', () => {
    const model = randomModel(5, 60);
    const before = plan(model, DEFAULT_SETTINGS);
    const first = before.sheets[0]?.boards[0];
    const [cutBlank, uncut] = first?.blanks ?? [];
    const partId = cutBlank?.parts[0]?.partId;
    if (!first || !cutBlank || !uncut || !partId) throw new Error('needs a W18 Board with two Blanks');
    const after = plan(model, changed, { plan: before, cut: [partId] }).sheets[0]?.boards[0];

    expect(after?.number).toBe(first.number);
    expect(after?.cuts).toEqual(first.cuts);
    expect(after?.blanks[0]).toEqual(cutBlank);
    const renested = after?.blanks[1];
    expect(renested && outline(renested)).toEqual(outline(uncut));
    expect(renested?.clampMargin).toBe(changed.clampMargin);
    expect(renested?.parts).not.toEqual(uncut.parts);
    // Its Parts are back inside it where they fit with the wider clamp margin.
    expect(renested?.parts.length).toBeGreaterThan(0);
  });

  it('records the clamp margin each Blank was nested with', () => {
    const result = plan(syntheticModel(), changed);
    expect(allBlanks(result).map((b) => b.clampMargin)).toEqual([55000, 55000]);
  });
});

describe('Remake, kept Offcuts and the needs-nesting order', () => {
  /** Two 400 × 300 Parts on one Blank of W18 Board 1. */
  function twoParts(): { model: Model; before: Plan } {
    const model = randomModel(1, 2);
    model.parts = model.parts.map((p) => ({
      ...p,
      sheetId: 's1',
      cutLength: 400000,
      cutWidth: 300000,
      grain: 'length' as const,
    }));
    return { model, before: plan(model, DEFAULT_SETTINGS) };
  }
  const board1 = (result: Plan) => result.sheets[0]?.boards.find((b) => b.number === 1);
  const inside = (r: Rect, o: Rect) =>
    r.x >= o.x && r.y >= o.y && r.x + r.length <= o.x + o.length && r.y + r.width <= o.y + o.width;

  it('greys a Remake Part on its old Blank and nests it on a fitting kept Offcut of the Locked Board', () => {
    const { model, before } = twoParts();
    const old = board1(before);
    expect(old?.blanks.map((b) => b.parts.length)).toEqual([2]);
    const k1 = old?.offcuts.find((o) => o.id === 'W18-1-K1');
    if (!old || !k1) throw new Error('needs Board 1 with K1');

    const after = plan(model, DEFAULT_SETTINGS, { plan: remakePart(before, 'p1'), cut: ['p0'] });
    const board = board1(after);

    // The old Blank keeps both Parts where they were, the Remake one greyed (remade).
    expect(board?.blanks[0]).toEqual({
      ...old.blanks[0],
      parts: old.blanks[0]?.parts.map((p) => (p.partId === 'p1' ? { ...p, remade: true } : p)),
    });
    // A new Blank, continuing the Board's letters, cut from K1.
    const blank = board?.blanks[1];
    expect(blank?.id).toBe('W18-1-B');
    expect(blank?.from).toBe('W18-1-K1');
    expect(blank?.parts.map((p) => p.partId)).toEqual(['p1']);
    if (!blank) throw new Error('needs the new Blank');
    expect(inside(blank, k1)).toBe(true);
    // K1 is used up; what's left of it is new Offcuts, kept ones numbered on from the Board's last K.
    expect(board?.offcuts.find((o) => o.id === 'W18-1-K1')).toEqual({ ...k1, used: true });
    const rest = board?.offcuts.slice(old.offcuts.length) ?? [];
    expect(rest.length).toBeGreaterThan(0);
    for (const o of rest) expect(inside(o, k1)).toBe(true);
    const keptBefore = old.offcuts.filter((x) => x.kept).length;
    expect(rest.filter((o) => o.kept).map((o) => o.id)).toEqual(
      rest.filter((o) => o.kept).map((_, i) => `W18-1-K${String(keptBefore + i + 1)}`),
    );
    // Its own saw entries, from K1.
    const extra = board?.cuts.slice(old.cuts.length) ?? [];
    expect(extra.length).toBeGreaterThan(0);
    for (const c of extra) expect(c.from).toBe('W18-1-K1');
    // No new Board, nothing waiting.
    expect(after.sheets[0]?.boards.map((b) => b.number)).toEqual([1]);
    expect(after.sheets[0]?.overflow).toEqual([]);
  });

  it('cuts a Remake Saw Part from a kept Offcut of the Locked Board too', () => {
    const { model } = twoParts();
    const sawCnc = { p1: 'saw' as const };
    const before = plan(model, DEFAULT_SETTINGS, { sawCnc });
    expect(board1(before)?.sawParts.map((p) => p.partId)).toEqual(['p1']);

    const after = plan(model, DEFAULT_SETTINGS, { plan: remakePart(before, 'p1'), cut: ['p0'], sawCnc });
    const board = board1(after);
    const again = board?.sawParts.find((p) => p.partId === 'p1' && !p.remade);
    const from = board?.offcuts.find((o) => o.used);
    if (!again || !from) throw new Error('the Remake Saw Part must be cut from a kept Offcut');
    expect(inside(again, from)).toBe(true);
    expect(board?.cuts.slice(board1(before)?.cuts.length).every((c) => c.from === from.id)).toBe(true);
    expect(after.sheets[0]?.boards.map((b) => b.number)).toEqual([1]);
    expect(after.sheets[0]?.overflow).toEqual([]);
  });

  it('ignores discarded Offcuts, and Discard can be undone', () => {
    const { model, before } = twoParts();
    const after = plan(model, DEFAULT_SETTINGS, {
      plan: remakePart(discardOffcut(before, 'W18-1-K1', true), 'p1'),
      cut: ['p0'],
    });

    expect(board1(after)?.blanks[1]?.from).toBe('W18-1-K2');
    expect(board1(after)?.offcuts.find((o) => o.id === 'W18-1-K1')).toMatchObject({ discarded: true });
    expect(discardOffcut(discardOffcut(before, 'W18-1-K1', true), 'W18-1-K1', false)).toEqual(before);
  });

  it('asks before adding a Board when no kept Offcut or unlocked Board fits, and adds it when allowed', () => {
    const { model, before } = twoParts();
    let marked = remakePart(before, 'p1');
    for (const o of board1(before)?.offcuts ?? []) if (o.id) marked = discardOffcut(marked, o.id, true);

    const asked = plan(model, DEFAULT_SETTINGS, { plan: marked, cut: ['p0'] });
    expect(asked.sheets[0]?.boards.map((b) => b.number)).toEqual([1]);
    expect(asked.sheets[0]?.overflow).toEqual(['p1']);
    expect(asked.sheets[0]?.extraBoards).toBe(1);

    const added = plan(model, DEFAULT_SETTINGS, { plan: asked, cut: ['p0'], addBoards: ['s1'] });
    expect(added.sheets[0]?.boards.map((b) => b.number)).toEqual([1, 2]);
    expect(added.sheets[0]?.boards[1]?.blanks.flatMap((b) => b.parts.map((p) => p.partId))).toEqual(['p1']);
    expect(added.sheets[0]?.overflow).toEqual([]);
  });

  it('falls through to the Breakdown of the unlocked Boards, ignoring their Offcuts', () => {
    // Board 1 Locked with every Offcut discarded, later Boards unlocked: an added Part goes into their Breakdown.
    const model = randomModel(5, 60);
    const before = plan(model, DEFAULT_SETTINGS);
    const sheet = before.sheets[0];
    const first = sheet?.boards[0];
    if (!first || !sheet || sheet.boards.length < 2) throw new Error('needs two W18 Boards');
    let marked = before;
    for (const o of first.offcuts) if (o.id) marked = discardOffcut(marked, o.id, true);
    const added: Part = { ...(model.parts[0] as Part), id: 'added', sheetId: 's1', cutLength: 300000, cutWidth: 200000 };

    const after = plan({ ...model, parts: [...model.parts, added] }, DEFAULT_SETTINGS, {
      plan: marked,
      cut: boardPartIds(first),
    });
    const where = after.sheets[0]?.boards.find((b) => b.blanks.some((x) => x.parts.some((p) => p.partId === 'added')));
    expect(where?.number).not.toBe(1);
    expect(where?.blanks.every((b) => b.from === undefined)).toBe(true);
    expect(after.sheets[0]?.boards.length).toBe(sheet.boards.length);
    expect(after.sheets[0]?.overflow).toEqual([]);
  });

  it('gives a brand-new Sheet its Boards without asking', () => {
    const { model, before } = twoParts();
    const oak: Part = { ...(model.parts[0] as Part), id: 'oak', sheetId: 's2' };
    const after = plan({ ...model, parts: [...model.parts, oak] }, DEFAULT_SETTINGS, { plan: before, cut: ['p0'] });

    expect(after.sheets[1]?.boards.map((b) => b.number)).toEqual([1]);
    expect(after.sheets[1]?.overflow).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])('holds the invariants after Remakes onto Offcuts (random export %i)', (seed) => {
    const model = randomModel(seed, 40);
    const before = plan(model, DEFAULT_SETTINGS);
    const random = rng(seed * 7);
    const cut = boardsOf(before)
      .flatMap((b) => b.blanks.flatMap((x) => x.parts.map((p) => p.partId)))
      .filter(() => random() < 0.2);
    const remade = cut.filter(() => random() < 0.5);
    const marked = remade.reduce(remakePart, before);
    const after = plan(model, DEFAULT_SETTINGS, {
      plan: marked,
      cut: cut.filter((id) => !remade.includes(id)),
      addBoards: ['s1', 's2'],
    });

    expectInvariants(model, after, DEFAULT_SETTINGS);
    // Locked Boards keep all they had, only gaining Blanks and Offcuts cut from kept Offcuts.
    for (const sheet of marked.sheets) {
      for (const old of sheet.boards) {
        if (!boardPartIds(old).some((id) => cut.includes(id))) continue;
        const kept = after.sheets
          .find((s) => s.sheetId === sheet.sheetId)
          ?.boards.find((b) => b.number === old.number);
        expect(kept?.blanks.slice(0, old.blanks.length)).toEqual(old.blanks);
        expect(kept?.sawParts).toEqual(old.sawParts);
        expect(kept?.cuts.slice(0, old.cuts.length)).toEqual(old.cuts);
      }
    }
  });
});

describe('Tiled Blanks', () => {  const cup = (x: number) => ({ kind: 'drill' as const, at: { x, y: 22000 }, diameter: 35000, depth: 13000 });
  const drill = { kind: 'drill' as const, at: { x: 32000, y: 32000 }, diameter: 5000, depth: 10000 };

  /** One 2800 × 2070 Sheet with a door and some shelves, all with CNC ops unless told otherwise. */
  function doorModel(door: Partial<Part> = {}, shelves = 6): Model {
    const model = randomModel(1, 1);
    const base = model.parts[0] as Part;
    model.sheets = model.sheets.slice(0, 1);
    model.parts = [
      { ...base, id: 'door', cutLength: 2000000, cutWidth: 600000, grain: 'length', top: [cup(100000), cup(1900000)], ...door },
      ...Array.from({ length: shelves }, (_, i) => ({
        ...base,
        id: `shelf${String(i)}`,
        cutLength: 560000,
        cutWidth: 400000,
        grain: 'length' as const,
        top: [drill],
      })),
    ];
    return model;
  }

  describe('partRule', () => {
    it('makes a Part longer than the usable bed but within its width tileable, on the CNC when it has CNC ops', () => {
      expect(partRule(doorModel(), DEFAULT_SETTINGS, 'door')).toEqual({
        auto: 'cnc',
        oversize: false,
        tileable: true,
        narrow: false,
        hasCncOps: true,
      });
    });

    it('cuts a tileable Part with no CNC ops on the saw by default', () => {
      expect(partRule(doorModel({ top: [] }), DEFAULT_SETTINGS, 'door')).toMatchObject({
        auto: 'saw',
        oversize: false,
        tileable: true,
      });
    });

    it('turns a grain-free Part so it is long along X when only that way fits the bed width', () => {
      expect(partRule(doorModel({ cutLength: 600000, cutWidth: 2000000, grain: 'none' }), DEFAULT_SETTINGS, 'door')).toMatchObject({
        oversize: false,
        tileable: true,
      });
      // Grained the wrong way: 2000 mm across the bed is too wide, and tiling only goes along X.
      expect(partRule(doorModel({ cutLength: 600000, cutWidth: 2000000, grain: 'length' }), DEFAULT_SETTINGS, 'door')).toMatchObject({
        oversize: true,
        tileable: false,
      });
    });

    it('keeps a Part too wide for the bed, or longer than the trimmed Board minus the clamp margins, oversize', () => {
      expect(partRule(doorModel({ cutWidth: 1400000 }), DEFAULT_SETTINGS, 'door')).toMatchObject({ auto: 'saw', oversize: true, tileable: false });
      // 2800 Board - 2 × 40 clamp = 2720.
      expect(partRule(doorModel({ cutLength: 2721000 }), DEFAULT_SETTINGS, 'door')).toMatchObject({ oversize: true, tileable: false });
      expect(partRule(doorModel({ cutLength: 2720000 }), DEFAULT_SETTINGS, 'door')).toMatchObject({ oversize: false, tileable: true });
      expect(
        partRule(doorModel({ cutLength: 2720000 }), { ...DEFAULT_SETTINGS, edgeTrim: 5000 }, 'door'),
      ).toMatchObject({ oversize: true });
    });

    it('is the rule from before tiling when Allow tiling is off', () => {
      expect(partRule(doorModel(), NO_TILING, 'door')).toEqual({
        auto: 'saw',
        oversize: true,
        tileable: false,
        narrow: false,
        hasCncOps: true,
      });
    });
  });

  it('puts a long door with CNC ops on one Tiled Blank, at most the bed wide, with other Parts beside it', () => {
    const model = doorModel();
    const result = plan(model, DEFAULT_SETTINGS);

    expectInvariants(model, result, DEFAULT_SETTINGS);
    expectRunOrder(model, result);
    expect(result.sheets[0]?.sawParts).toEqual([]);
    const tiled = allBlanks(result).filter((b) => b.tiled);
    expect(tiled).toHaveLength(1);
    const blank = tiled[0] as Blank;
    expect(blank.length).toBeGreaterThanOrEqual(2000000 + 2 * 40000);
    expect(blank.width).toBeLessThanOrEqual(1300000);
    expect(blank.parts.map((p) => p.partId)).toContain('door');
    // The rest of its width is filled with shelves.
    expect(blank.parts.length).toBeGreaterThan(1);
    // No other Blank is tiled or longer than the bed.
    for (const b of allBlanks(result).filter((x) => x !== blank)) expect(b.length).toBeLessThanOrEqual(1300000);
  });

  it('makes a tileable Part with no CNC ops a Saw Part (longer than the bed), which the toggle sends to the CNC', () => {
    const model = doorModel({ top: [] });
    const sawn = plan(model, DEFAULT_SETTINGS);
    expect(sawn.sheets[0]?.sawReasons).toEqual({ door: 'long' });
    expect(allBlanks(sawn).some((b) => b.tiled)).toBe(false);

    const toggled = plan(model, DEFAULT_SETTINGS, { sawCnc: { door: 'cnc' } });
    expectInvariants(model, toggled, DEFAULT_SETTINGS);
    expect(toggled.sheets[0]?.sawParts).toEqual([]);
    expect(allBlanks(toggled).find((b) => b.parts.some((p) => p.partId === 'door'))?.tiled).toBe(true);
  });

  it('sends a tileable Part with CNC ops to the saw by hand', () => {
    const result = plan(doorModel(), DEFAULT_SETTINGS, { sawCnc: { door: 'saw' } });
    expect(result.sheets[0]?.sawReasons).toEqual({ door: 'chosen' });
    expect(allBlanks(result).some((b) => b.tiled)).toBe(false);
  });

  it('keeps a Part too wide for the bed a Saw Part, whatever the toggle', () => {
    const result = plan(doorModel({ cutWidth: 1400000 }), DEFAULT_SETTINGS, { sawCnc: { door: 'cnc' } });
    expect(result.sheets[0]?.sawReasons).toEqual({ door: 'oversize' });
    expect(allBlanks(result).some((b) => b.tiled)).toBe(false);
  });

  it('plans as before tiling when Allow tiling is off', () => {
    const model = doorModel();
    const result = plan(model, NO_TILING, { sawCnc: { door: 'cnc' } });
    expectInvariants(model, result, NO_TILING);
    expect(result.sheets[0]?.sawReasons).toEqual({ door: 'oversize' });
    expect(allBlanks(result).some((b) => b.tiled || b.length > 1300000)).toBe(false);
  });

  it('nests a tileable Part on a kept Offcut of a Locked Board as a Tiled Blank', () => {
    const model = doorModel({}, 1);
    model.parts = model.parts.map((p) => (p.id === 'door' ? { ...p, cutWidth: 300000 } : p));
    const before = plan(model, DEFAULT_SETTINGS);
    const cut = ['shelf0'];
    const marked = remakePart(before, 'door');
    const after = plan(model, DEFAULT_SETTINGS, { plan: marked, cut });

    const door = after.sheets[0]?.boards.flatMap((b) => b.blanks).find((b) => b.parts.some((p) => p.partId === 'door' && !p.remade) && b.from);
    expect(door?.tiled).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'holds the invariants and Run order with tiling on (random export %i with CNC ops)',
    (seed) => {
      const model = randomModel(seed, 40);
      model.parts = model.parts.map((p, i) => (i % 2 === 0 ? { ...p, top: [drill] } : p));
      const result = plan(model, DEFAULT_SETTINGS);
      expectInvariants(model, result, DEFAULT_SETTINGS);
      expectRunOrder(model, result);
    },
  );

  it('keeps tiling off for Locked Boards planned without it, and holds the invariants', () => {
    const model = randomModel(3, 40);
    model.parts = model.parts.map((p) => ({ ...p, top: [drill] }));
    const before = plan(model, NO_TILING);
    const cut = before.sheets.flatMap((s) => s.boards.slice(0, 1).flatMap(boardPartIds)).slice(0, 1);
    const after = plan(model, DEFAULT_SETTINGS, { plan: before, cut });
    expectInvariants(model, after, DEFAULT_SETTINGS);
    expect(allBlanks(after).some((b) => b.tiled)).toBe(true);
  });
});

const boardsOf = (result: Plan) => result.sheets.flatMap((s) => s.boards);
const boardPartIds = (b: Board) => [
  ...b.blanks.flatMap((x) => x.parts.map((p) => p.partId)),
  ...b.sawParts.map((p) => p.partId),
];

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
    manualOps: [],
    edges: {},
  }));
  return {
    projectName: 'Random',
    edgebands: [],
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
