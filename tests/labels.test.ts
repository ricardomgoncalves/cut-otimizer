import { describe, expect, it } from 'vitest';
import { stickerSpot } from '../src/core/documents/labels.ts';
import type { CncOp, Part } from '../src/core/model.ts';
import { mm } from './cut-sheet-plan.ts';

function bare(cutLength: number, cutWidth: number, ops: { top?: CncOp[]; bottom?: CncOp[] } = {}): Part {
  return {
    id: 'p',
    name: 'p',
    partName: 'P',
    displayName: 'B1 · P',
    ownerId: 'c1',
    sheetId: 's1',
    thickness: mm(18),
    cutLength: mm(cutLength),
    cutWidth: mm(cutWidth),
    grain: 'none',
    top: ops.top ?? [],
    bottom: ops.bottom ?? [],
    manualOps: [],
    edges: {},
  };
}

const drill = (x: number, y: number, d: number, depth: number | 'through'): CncOp => ({
  kind: 'drill',
  at: { x: mm(x), y: mm(y) },
  diameter: mm(d),
  depth: depth === 'through' ? 'through' : mm(depth),
});

/** The spot in mm, rounded to 0.01. */
function spotMm(part: Part) {
  const s = stickerSpot(part);
  if (!s) return null;
  const r = (v: number) => Math.round(v / 10) / 100;
  return { x: r(s.x), y: r(s.y), length: r(s.length), width: r(s.width), rotated: s.rotated };
}

describe('stickerSpot: where the label goes on the bottom face', () => {
  it('is centred on a Part with nothing on its bottom face', () => {
    // (600 − 99.1) / 2 = 250.45, (400 − 38.1) / 2 = 180.95.
    expect(spotMm(bare(600, 400))).toEqual({ x: 250.45, y: 180.95, length: 99.1, width: 38.1, rotated: false });
  });

  it('ignores blind top ops: they are on the other face', () => {
    expect(spotMm(bare(600, 400, { top: [drill(300, 200, 10, 12)] }))?.y).toBe(180.95);
  });

  it('moves the least distance off a bottom op, keeping 3 mm clear of it', () => {
    // Ø10 at (300, 205) blocks y 197..213 (with 3 mm clearance): below it the spot starts at 197 − 38.1 = 158.9
    // (22.05 off centre); above it at 213 (32.05 off); sideways would be 57.55 off.
    expect(spotMm(bare(600, 400, { bottom: [drill(300, 205, 10, 13)] }))).toEqual({
      x: 250.45,
      y: 158.9,
      length: 99.1,
      width: 38.1,
      rotated: false,
    });
  });

  it('avoids through holes (they show on the bottom face) and bottom grooves and pockets', () => {
    const groove: CncOp = { kind: 'groove', from: { x: 0, y: mm(170) }, to: { x: mm(600), y: mm(170) }, width: mm(8), depth: mm(8) };
    const pocket: CncOp = { kind: 'pocket', centre: { x: mm(300), y: mm(250) }, length: mm(40), width: mm(20), depth: mm(5) };
    // The groove blocks y 163..177 and the pocket 277..323 × 237..263 (3 mm clearance included).
    const s = spotMm(bare(600, 400, { top: [drill(250, 200, 5, 'through')], bottom: [groove, pocket] }));

    // The through hole Ø5 at (250, 200) blocks 244.5..255.5 × 194.5..205.5, so the centred spot is blocked.
    expect(s).not.toBeNull();
    const spot = s ?? { x: 0, y: 0, length: 0, width: 0 };
    const clear = (x0: number, y0: number, x1: number, y1: number) =>
      spot.x >= x1 || spot.x + spot.length <= x0 || spot.y >= y1 || spot.y + spot.width <= y0;
    expect(clear(244.5, 194.5, 255.5, 205.5)).toBe(true);
    expect(clear(0, 163, 600, 177)).toBe(true);
    expect(clear(277, 237, 323, 263)).toBe(true);
    // Nearest to the middle of all clear spots: just right of the hole (5.05 off), still in the 177..237 band.
    expect(spot).toMatchObject({ x: 255.5, y: 180.95 });
  });

  it('stays 15 mm from every edge and turns the sticker when only that fits', () => {
    // 100 long: 100 − 30 = 70 < 99.1, so the sticker can't lie along X. Turned (38.1 along X, 99.1 along Y) it
    // fits the 270 of width left: centred at x (100 − 38.1) / 2, y (300 − 99.1) / 2.
    expect(spotMm(bare(100, 300))).toEqual({ x: 30.95, y: 100.45, length: 38.1, width: 99.1, rotated: true });
  });

  it('is null when no clear spot fits (the label then says so)', () => {
    expect(stickerSpot(bare(100, 60))).toBeNull();
    // Room for the sticker, but ops everywhere.
    const holes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => drill(20 + i * 20, 50, 5, 13));
    expect(stickerSpot(bare(250, 100, { bottom: holes }))).toBeNull();
  });
});
