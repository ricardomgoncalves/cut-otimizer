// Planner: domain model + settings (+ the Job's Saw / CNC choices) -> Plan: the Breakdown of each
// Board into Blanks, Saw Parts and Offcuts, a Layout per Blank, and the Run order.
//
// Rules (ticket #27; PRD stories 3.1–3.6 and 5.1–5.3):
// - Saw Parts: a Part bigger than the usable bed is always one ('oversize'). A Part narrower than Min CNC
//   width on its shorter cut side with no CNC ops becomes one automatically ('narrow'). The Job's per-Part
//   Saw / CNC toggle (`prior.sawCnc`) overrides that, both ways, except for 'oversize' Parts. A narrow Part
//   left on the CNC is nested like any other and flagged `narrow` (a warning, not a different rule).
// - Breakdown, one Board at a time: two-stage guillotine. Rip strips from the front edge (after edge trim),
//   then crosscut each strip from the left into pieces, with saw kerf between pieces. A piece is a Blank
//   (no larger than the bed, Parts nested with maxrects BSSF inside the clamp margin, the bit diameter
//   between Parts) or a Saw Part (in a strip as wide as the Part). Blanks shrink to what their Layout uses,
//   so a strip shrinks too and the waste stays in one larger Offcut.
// - Blank sizes per Board: several strip-width and Blank-length caps are tried (the bed and sizes taken
//   from the Parts). Each strip is chosen greedily by the most Part area it places. The Board plans are
//   scored: most Part area placed, then fewest Blanks, then the largest rectangular Offcut.
// - Run order: Sheets grouped by thickness (groups and Sheets in export order). Boards are numbered and
//   Blanks lettered in saw order (rip 1, crosscuts 1a, 1b…, rip 2…). `#n` within a Blank goes by position:
//   front row left to right, then the next row back (sort by y, then x).
// - Blanks are never rotated: Board length runs along X. Only `grain: none` Parts may rotate.
// - Only `top` ops go to Side A (Flip Parts are #28).
import { MaxRectsBin, PACKING_LOGIC, Rectangle } from 'maxrects-packer';
import type { CncOp, Model, Part, Sheet } from '../model.ts';
import { edgeTrimFor, type Settings } from '../settings.ts';

/** A Part nested on a Blank. Coordinates are µm in the Blank frame (origin front-left). */
export interface Placement {
  /** `#n` within the Blank: front row left to right, then the next row back. */
  n: number;
  partId: string;
  /** Front-left corner of the Part's footprint on the Blank. */
  x: number;
  y: number;
  /** `false`: the Part's X runs along the Blank's X. `true`: turned 90° counter-clockwise (seen from the top), so the Part's X runs along the Blank's Y. */
  rotated: boolean;
  cutLength: number;
  cutWidth: number;
  /** Side A ops, in the Part's cut frame (unrotated). */
  ops: CncOp[];
  /** Narrower than Min CNC width but kept on the CNC: warn (check tabs). */
  narrow: boolean;
}

export interface Blank {
  /** `<Sheet code>-<Board>-<letter>`, e.g. `W18-1-A`. */
  id: string;
  letter: string;
  /** Position on the Board (origin front-left of the Board, X along its length). */
  x: number;
  y: number;
  length: number;
  width: number;
  /** In `#n` order. */
  parts: Placement[];
}

/** Why a Part is cut on the saw. */
export type SawReason = 'oversize' | 'narrow' | 'chosen';

/** A Saw Part's piece in a Board's Breakdown. */
export interface SawPlacement {
  partId: string;
  /** Footprint on the Board (front-left corner, X along the Board length). */
  x: number;
  y: number;
  length: number;
  width: number;
  /** Turned 90°: the Part's X runs along the Board's Y. */
  rotated: boolean;
  reason: SawReason;
}

/** A leftover piece of the Breakdown. `kept` when at least Min Offcut size on both sides. */
export interface Offcut {
  x: number;
  y: number;
  length: number;
  width: number;
  kept: boolean;
}

/**
 * One saw cut, in saw order. A rip (`1`, `2`…) runs along X from (x, y) for `length`; a crosscut
 * (`1a`, `1b`…) runs along Y from (x, y) for `length`. The kerf lies on the far side of (x, y):
 * above y for a rip, right of x for a crosscut.
 */
export interface Cut {
  label: string;
  kind: 'rip' | 'cross';
  x: number;
  y: number;
  length: number;
}

export interface Board {
  /** 1-based within its Sheet. */
  number: number;
  length: number;
  width: number;
  /** In saw order (= letter order). */
  blanks: Blank[];
  /** Saw Parts cut from this Board, in saw order. */
  sawParts: SawPlacement[];
  offcuts: Offcut[];
  /** In saw order. Edge trim cuts are not listed. */
  cuts: Cut[];
}

export interface SheetPlan {
  sheetId: string;
  code: string;
  thickness: number;
  boards: Board[];
  /** Part ids cut on the saw rather than the CNC, in export order. */
  sawParts: string[];
  sawReasons: Record<string, SawReason>;
  /** Saw Parts too big for a Board of this Sheet: on no Board. */
  unplaced: string[];
}

export interface Plan {
  /** The settings the Plan was made with (the DXF writer reads the clamp margin from here). */
  settings: Settings;
  /** In Run order: grouped by thickness, groups and Sheets in export order. */
  sheets: SheetPlan[];
}

export type PartMode = 'saw' | 'cnc';

/** What the Planner keeps from earlier: the Job's choices. */
export interface PlanPrior {
  /** Per-Part Saw / CNC toggle, by Part id. Ignored for Parts bigger than the usable bed. */
  sawCnc?: Record<string, PartMode>;
}

/** How a Part is cut without any toggle, and whether the toggle applies. */
export interface PartRule {
  auto: PartMode;
  /** Bigger than the usable bed: always a Saw Part, no toggle. */
  oversize: boolean;
  /** Shorter cut side under Min CNC width. */
  narrow: boolean;
  /** Has ops the CNC runs (top, or bottom kinds not set to manual). */
  hasCncOps: boolean;
}

/** Plans every Sheet of the model. Pure and deterministic. */
export function plan(model: Model, settings: Settings, prior: PlanPrior = {}): Plan {
  return {
    settings,
    sheets: runOrder(model.sheets).map((sheet) =>
      planSheet(
        sheet,
        model.parts.filter((p) => p.sheetId === sheet.id),
        settings,
        prior.sawCnc ?? {},
      ),
    ),
  };
}

/** The Saw / CNC rule for one Part of the model. */
export function partRule(model: Model, settings: Settings, partId: string): PartRule | null {
  const part = model.parts.find((p) => p.id === partId);
  const sheet = model.sheets.find((s) => s.id === part?.sheetId);
  if (!part || !sheet) return null;
  return ruleFor(part, sheet, settings);
}

function ruleFor(part: Part, sheet: Sheet, settings: Settings): PartRule {
  const { length, width } = largestPiece(sheet, settings);
  const usableL = length - 2 * settings.clampMargin;
  const usableW = width - 2 * settings.clampMargin;
  const fits = (l: number, w: number) => l <= usableL && w <= usableW;
  const oversize = !(
    fits(part.cutLength, part.cutWidth) ||
    (part.grain === 'none' && fits(part.cutWidth, part.cutLength))
  );
  const narrow = Math.min(part.cutLength, part.cutWidth) < settings.minCncWidth;
  const hasCncOps =
    part.top.length > 0 || part.bottom.some((op) => !settings.manualBottomOpKinds.includes(op.kind));
  return { auto: oversize || (narrow && !hasCncOps) ? 'saw' : 'cnc', oversize, narrow, hasCncOps };
}

/** Sheets grouped by thickness, groups in order of first appearance, Sheets in export order. */
function runOrder(sheets: Sheet[]): Sheet[] {
  const thicknesses = [...new Set(sheets.map((s) => s.thickness))];
  return thicknesses.flatMap((t) => sheets.filter((s) => s.thickness === t));
}

/** The trimmed Board area. */
interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function trimmedArea(sheet: Sheet, settings: Settings): Area {
  const trim = edgeTrimFor(settings, sheet.id);
  return { x0: trim, y0: trim, x1: sheet.length - trim, y1: sheet.width - trim };
}

/** The largest Blank a Board of this Sheet gives: the bed, or the trimmed Board if smaller. */
function largestPiece(sheet: Sheet, settings: Settings) {
  const a = trimmedArea(sheet, settings);
  return {
    length: Math.min(settings.bedLength, a.x1 - a.x0),
    width: Math.min(settings.bedWidth, a.y1 - a.y0),
  };
}

interface SawItem {
  part: Part;
  reason: SawReason;
}

function planSheet(
  sheet: Sheet,
  parts: Part[],
  settings: Settings,
  sawCnc: Record<string, PartMode>,
): SheetPlan {
  const cnc: Part[] = [];
  const saw: SawItem[] = [];
  for (const part of parts) {
    const rule = ruleFor(part, sheet, settings);
    const choice = sawCnc[part.id];
    if (rule.oversize) saw.push({ part, reason: 'oversize' });
    else if (choice === 'cnc') cnc.push(part);
    else if (choice === 'saw') saw.push({ part, reason: rule.auto === 'saw' ? 'narrow' : 'chosen' });
    else if (rule.auto === 'saw') saw.push({ part, reason: 'narrow' });
    else cnc.push(part);
  }

  const area = trimmedArea(sheet, settings);
  const fitsBoard = (p: Part) =>
    sawOrientations(p).some((o) => o.length <= area.x1 - area.x0 && o.width <= area.y1 - area.y0);
  const unplaced = saw.filter((s) => !fitsBoard(s.part)).map((s) => s.part.id);

  const ctx: Ctx = {
    sheet,
    settings,
    area,
    narrow: new Set(parts.filter((p) => ruleFor(p, sheet, settings).narrow).map((p) => p.id)),
  };
  let remainingCnc = nestingOrder(cnc);
  let remainingSaw = sawOrder(saw.filter((s) => fitsBoard(s.part)));
  const boards: Board[] = [];

  while (remainingCnc.length > 0 || remainingSaw.length > 0) {
    const draft = bestBoard(ctx, remainingCnc, remainingSaw);
    if (!draft) break; // Cannot happen: every remaining Part fits an empty Board.
    const board = finishBoard(ctx, draft, boards.length + 1);
    boards.push(board);
    const used = new Set(draftPartIds(draft));
    remainingCnc = remainingCnc.filter((p) => !used.has(p.id));
    remainingSaw = remainingSaw.filter((s) => !used.has(s.part.id));
  }

  return {
    sheetId: sheet.id,
    code: sheet.code,
    thickness: sheet.thickness,
    boards,
    sawParts: saw.map((s) => s.part.id),
    sawReasons: Object.fromEntries(saw.map((s) => [s.part.id, s.reason])),
    unplaced,
  };
}

interface Ctx {
  sheet: Sheet;
  settings: Settings;
  area: Area;
  narrow: Set<string>;
}

type DraftPiece =
  | { kind: 'blank'; x: number; length: number; placed: Omit<Placement, 'n'>[] }
  | { kind: 'saw'; x: number; length: number; item: SawItem; rotated: boolean };

interface DraftStrip {
  y: number;
  width: number;
  pieces: DraftPiece[];
  area: number;
  blanks: number;
}

interface DraftBoard {
  strips: DraftStrip[];
  area: number;
  blanks: number;
}

function draftPartIds(draft: DraftBoard): string[] {
  return draft.strips.flatMap((s) =>
    s.pieces.flatMap((p) => (p.kind === 'blank' ? p.placed.map((q) => q.partId) : [p.item.part.id])),
  );
}

/**
 * Tries each pair of strip-width and Blank-length caps and keeps the best Board plan: most Part area
 * placed, then fewest Blanks, then the largest Offcut. Ties go to the earlier caps (larger first).
 */
function bestBoard(ctx: Ctx, cnc: Part[], saw: SawItem[]): DraftBoard | null {
  const { settings } = ctx;
  const piece = largestPiece(ctx.sheet, settings);
  const pad = 2 * settings.clampMargin;
  const widths = capCandidates(
    piece.width,
    cnc.flatMap((p) => footprints(p).map((f) => f.width + pad)),
  );
  const lengths = capCandidates(
    piece.length,
    cnc.flatMap((p) => footprints(p).map((f) => f.length + pad)),
  );

  let best: { draft: DraftBoard; offcut: number } | null = null;
  for (const wCap of widths) {
    for (const lCap of lengths) {
      const draft = fillBoard(ctx, cnc, saw, wCap, lCap);
      if (draft.area === 0) continue;
      const offcut = Math.max(0, ...offcutsOf(ctx, draft).map((o) => o.length * o.width));
      if (
        !best ||
        draft.area > best.draft.area ||
        (draft.area === best.draft.area &&
          (draft.blanks < best.draft.blanks || (draft.blanks === best.draft.blanks && offcut > best.offcut)))
      ) {
        best = { draft, offcut };
      }
    }
  }
  return best?.draft ?? null;
}

/** The bed-limited size, then up to three of the largest smaller sizes taken from the Parts. */
function capCandidates(max: number, fromParts: number[]): number[] {
  const smaller = [...new Set(fromParts)].filter((v) => v < max).sort((a, b) => b - a);
  return [max, ...smaller.slice(0, 3)];
}

/** Builds one Board plan greedily, strip by strip from the front edge. */
function fillBoard(ctx: Ctx, cncIn: Part[], sawIn: SawItem[], wCap: number, lCap: number): DraftBoard {
  const { area, settings } = ctx;
  let cnc = cncIn;
  let saw = sawIn;
  const strips: DraftStrip[] = [];
  let y = area.y0;

  for (;;) {
    const avail = area.y1 - y;
    if (avail <= 0 || (cnc.length === 0 && saw.length === 0)) break;
    const options: number[] = [];
    const blankWidth = Math.min(wCap, avail);
    if (blankWidth > 2 * settings.clampMargin) options.push(blankWidth);
    for (const s of saw) {
      for (const o of sawOrientations(s.part)) {
        if (o.width <= avail && o.length <= area.x1 - area.x0 && !options.includes(o.width))
          options.push(o.width);
      }
    }

    let best: DraftStrip | null = null;
    for (const width of options) {
      const strip = fillStrip(ctx, y, width, cnc, saw, lCap);
      if (
        strip.area > 0 &&
        (!best ||
          strip.area > best.area ||
          (strip.area === best.area &&
            (strip.blanks < best.blanks || (strip.blanks === best.blanks && strip.width < best.width))))
      ) {
        best = strip;
      }
    }
    if (!best) break;
    strips.push(best);
    const used = new Set(draftPartIds({ strips: [best], area: 0, blanks: 0 }));
    cnc = cnc.filter((p) => !used.has(p.id));
    saw = saw.filter((s) => !used.has(s.part.id));
    y += best.width + settings.sawKerf;
  }

  return {
    strips,
    area: strips.reduce((a, s) => a + s.area, 0),
    blanks: strips.reduce((a, s) => a + s.blanks, 0),
  };
}

/**
 * One strip of the given width: first the Saw Parts exactly that wide (longest first), then Blanks
 * left to right while they get Parts. A strip without Saw Parts shrinks to its widest Layout.
 */
function fillStrip(
  ctx: Ctx,
  y: number,
  width: number,
  cncIn: Part[],
  saw: SawItem[],
  lCap: number,
): DraftStrip {
  const { area, settings } = ctx;
  const clamp = settings.clampMargin;
  const pieces: DraftPiece[] = [];
  let x = area.x0;
  let placedArea = 0;

  for (const s of saw) {
    const o = sawOrientations(s.part).find((f) => f.width === width);
    if (!o || x + o.length > area.x1) continue;
    pieces.push({ kind: 'saw', x, length: o.length, item: s, rotated: o.rotated });
    placedArea += o.length * o.width;
    x += o.length + settings.sawKerf;
  }

  let cnc = cncIn;
  let blanks = 0;
  let usedWidth = 0;
  if (width <= settings.bedWidth && width > 2 * clamp) {
    while (cnc.length > 0 && area.x1 - x > 2 * clamp) {
      const length = Math.min(lCap, settings.bedLength, area.x1 - x);
      const { placed, left } = nest(ctx, length, width, cnc);
      if (placed.length === 0) break;
      const usedLength = Math.max(...placed.map((p) => p.x + (p.rotated ? p.cutWidth : p.cutLength))) + clamp;
      const blankWidth = Math.max(...placed.map((p) => p.y + (p.rotated ? p.cutLength : p.cutWidth))) + clamp;
      usedWidth = Math.max(usedWidth, blankWidth);
      pieces.push({ kind: 'blank', x, length: usedLength, placed });
      placedArea += placed.reduce((a, p) => a + p.cutLength * p.cutWidth, 0);
      blanks++;
      cnc = left;
      x += usedLength + settings.sawKerf;
    }
  }

  const hasSaw = pieces.some((p) => p.kind === 'saw');
  return { y, width: hasSaw ? width : usedWidth, pieces, area: placedArea, blanks };
}

/** The Offcuts of a draft: each strip's right-hand rest, then the rest of the Board behind the last strip. */
function offcutsOf(ctx: Ctx, draft: DraftBoard): Offcut[] {
  const { area, settings } = ctx;
  const kerf = settings.sawKerf;
  const offcut = (x: number, y: number, length: number, width: number): Offcut => ({
    x,
    y,
    length,
    width,
    kept: Math.min(length, width) >= settings.minOffcutSize,
  });
  const out: Offcut[] = [];
  for (const strip of draft.strips) {
    const last = strip.pieces[strip.pieces.length - 1];
    const end = last ? last.x + last.length : area.x0;
    if (end + kerf < area.x1) out.push(offcut(end + kerf, strip.y, area.x1 - end - kerf, strip.width));
  }
  const lastStrip = draft.strips[draft.strips.length - 1];
  const back = lastStrip ? lastStrip.y + lastStrip.width : area.y0;
  if (back + kerf < area.y1) out.push(offcut(area.x0, back + kerf, area.x1 - area.x0, area.y1 - back - kerf));
  return out;
}

/** Letters the Blanks in saw order, numbers the cuts and lists the Offcuts. */
function finishBoard(ctx: Ctx, draft: DraftBoard, number: number): Board {
  const { area, sheet } = ctx;
  const blanks: Blank[] = [];
  const sawParts: SawPlacement[] = [];
  const cuts: Cut[] = [];

  draft.strips.forEach((strip, i) => {
    const rip = String(i + 1);
    if (strip.y + strip.width < area.y1) {
      cuts.push({ label: rip, kind: 'rip', x: area.x0, y: strip.y + strip.width, length: area.x1 - area.x0 });
    }
    strip.pieces.forEach((piece, j) => {
      const end = piece.x + piece.length;
      if (end < area.x1) {
        cuts.push({ label: rip + crossLetter(j), kind: 'cross', x: end, y: strip.y, length: strip.width });
      }
      if (piece.kind === 'saw') {
        sawParts.push({
          partId: piece.item.part.id,
          x: piece.x,
          y: strip.y,
          length: piece.length,
          width: strip.width,
          rotated: piece.rotated,
          reason: piece.item.reason,
        });
        return;
      }
      const letter = blankLetter(blanks.length);
      const parts = [...piece.placed]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((p, k) => ({ n: k + 1, ...p }));
      blanks.push({
        id: `${sheet.code}-${String(number)}-${letter}`,
        letter,
        x: piece.x,
        y: strip.y,
        length: piece.length,
        width: strip.width,
        parts,
      });
    });
  });

  return {
    number,
    length: sheet.length,
    width: sheet.width,
    blanks,
    sawParts,
    offcuts: offcutsOf(ctx, draft),
    cuts,
  };
}

interface Footprint {
  length: number;
  width: number;
  rotated: boolean;
}

/** The footprints a Part may take on a Blank (turned only when its grain allows). */
function footprints(p: Part): Footprint[] {
  const plain = { length: p.cutLength, width: p.cutWidth, rotated: false };
  return p.grain === 'none' && p.cutLength !== p.cutWidth
    ? [plain, { length: p.cutWidth, width: p.cutLength, rotated: true }]
    : [plain];
}

/** A Saw Part's footprints on the Board, the one along the Board length first. */
function sawOrientations(p: Part): Footprint[] {
  return [...footprints(p)].sort((a, b) => b.length - a.length);
}

/** Largest first: longest side, then area, then export id for a stable order. */
function nestingOrder(parts: Part[]): Part[] {
  const maxSide = (p: Part) => Math.max(p.cutLength, p.cutWidth);
  return [...parts].sort(
    (a, b) =>
      maxSide(b) - maxSide(a) ||
      b.cutLength * b.cutWidth - a.cutLength * a.cutWidth ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Saw Parts longest first, then by id. */
function sawOrder(items: SawItem[]): SawItem[] {
  const maxSide = (p: Part) => Math.max(p.cutLength, p.cutWidth);
  return [...items].sort(
    (a, b) =>
      maxSide(b.part) - maxSide(a.part) || (a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0),
  );
}

/** Nests as many Parts as fit on one Blank, in order, with maxrects BSSF. */
function nest(
  ctx: Ctx,
  length: number,
  width: number,
  parts: Part[],
): { placed: Omit<Placement, 'n'>[]; left: Part[] } {
  const { settings } = ctx;
  const usableL = length - 2 * settings.clampMargin;
  const usableW = width - 2 * settings.clampMargin;
  // MaxRectsBin reserves `padding` after every rect and grows its free area by the same amount,
  // so Parts may touch the usable edge and keep the bit diameter between each other.
  const bin = new MaxRectsBin<Rectangle>(usableL, usableW, settings.bitDiameter, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: true,
    // MAX_EDGE selects Best Short Side Fit in MaxRectsBin.findNode.
    logic: PACKING_LOGIC.MAX_EDGE,
  });

  const placed: Omit<Placement, 'n'>[] = [];
  const left: Part[] = [];
  for (const part of parts) {
    const rect = new Rectangle(part.cutLength, part.cutWidth, 0, 0, false, part.grain === 'none');
    const result = bin.add(rect);
    if (!result) {
      left.push(part);
      continue;
    }
    placed.push({
      partId: part.id,
      x: settings.clampMargin + result.x,
      y: settings.clampMargin + result.y,
      rotated: result.rot,
      cutLength: part.cutLength,
      cutWidth: part.cutWidth,
      ops: part.top,
      narrow: ctx.narrow.has(part.id),
    });
  }
  return { placed, left };
}

/** A, B, ... Z, AA, AB, ... */
function blankLetter(index: number): string {
  let s = '';
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}

/** a, b, ... z, aa, ... */
function crossLetter(index: number): string {
  return blankLetter(index).toLowerCase();
}
