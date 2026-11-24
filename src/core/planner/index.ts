// Planner: domain model + settings -> Plan (Breakdown of Boards into Blanks, Layouts per Blank).
//
// v0 (tracer bullet, ticket #24):
// - Each Sheet is planned on its own, Sheets in export order.
// - A Board is ripped into strips no wider than the bed, and each strip crosscut into pieces no
//   longer than the bed, with saw kerf between pieces (a fixed grid; see `sawPieces`). Blank sizes
//   are not chosen or scored yet (ticket #27).
// - Parts are nested with maxrects (BSSF) inside each piece minus the clamp margin, with the bit
//   diameter between Parts. A piece that gets Parts is a Blank; an empty one is not used.
// - A Part that cannot fit the usable bed (in any orientation its grain allows) is a Saw Part.
//   Saw Parts are listed per Sheet; they are not yet laid out on a Board (ticket #27).
// - Blanks are never rotated: Board length runs along X. Only `grain: none` Parts may rotate.
// - Only `top` ops go to Side A; `bottom` ops are ignored (Import warns; Flip Parts are #28).
import { MaxRectsBin, PACKING_LOGIC, Rectangle } from 'maxrects-packer';
import type { CncOp, Model, Part, Sheet } from '../model.ts';
import type { Settings } from '../settings.ts';

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

export interface Board {
  /** 1-based within its Sheet. */
  number: number;
  length: number;
  width: number;
  /** In saw order (= letter order). */
  blanks: Blank[];
}

export interface SheetPlan {
  sheetId: string;
  code: string;
  thickness: number;
  boards: Board[];
  /** Part ids cut on the saw rather than the CNC, in export order. */
  sawParts: string[];
}

export interface Plan {
  /** The settings the Plan was made with (the DXF writer reads the clamp margin from here). */
  settings: Settings;
  /** In export order. */
  sheets: SheetPlan[];
}

/** Plans every Sheet of the model. Pure and deterministic. */
export function plan(model: Model, settings: Settings): Plan {
  return {
    settings,
    sheets: model.sheets.map((sheet) =>
      planSheet(
        sheet,
        model.parts.filter((p) => p.sheetId === sheet.id),
        settings,
      ),
    ),
  };
}

interface Piece {
  x: number;
  y: number;
  length: number;
  width: number;
}

function planSheet(sheet: Sheet, parts: Part[], settings: Settings): SheetPlan {
  const pieces = sawPieces(sheet, settings);
  const largest = pieces[0];
  const fitsUsable = (p: Part) => {
    if (!largest) return false;
    const usableL = largest.length - 2 * settings.clampMargin;
    const usableW = largest.width - 2 * settings.clampMargin;
    const fits = (l: number, w: number) => l <= usableL && w <= usableW;
    return fits(p.cutLength, p.cutWidth) || (p.grain === 'none' && fits(p.cutWidth, p.cutLength));
  };

  const sawParts = parts.filter((p) => !fitsUsable(p)).map((p) => p.id);
  let remaining = nestingOrder(parts.filter(fitsUsable));
  const boards: Board[] = [];

  while (remaining.length > 0) {
    const number = boards.length + 1;
    const blanks: Blank[] = [];
    for (const piece of pieces) {
      if (remaining.length === 0) break;
      const { placed, left } = nest(piece, remaining, settings);
      remaining = left;
      if (placed.length === 0) continue;
      const letter = blankLetter(blanks.length);
      blanks.push({ id: `${sheet.code}-${String(number)}-${letter}`, letter, ...piece, parts: placed });
    }
    // The first piece is the full usable bed, which every remaining Part fits, so a Board
    // always takes at least one Part and this loop ends.
    boards.push({ number, length: sheet.length, width: sheet.width, blanks });
  }

  return { sheetId: sheet.id, code: sheet.code, thickness: sheet.thickness, boards, sawParts };
}

/**
 * The fixed v0 Breakdown of a Board, in saw order: rip strips from the front edge, each as wide as
 * the bed allows, then crosscut each strip from the left into pieces as long as the bed allows.
 * Pieces too small to hold anything inside the clamp margin are left out.
 */
function sawPieces(sheet: Sheet, settings: Settings): Piece[] {
  const pieces: Piece[] = [];
  const minSide = 2 * settings.clampMargin;
  for (let y = 0; y < sheet.width; y += settings.bedWidth + settings.sawKerf) {
    const width = Math.min(settings.bedWidth, sheet.width - y);
    for (let x = 0; x < sheet.length; x += settings.bedLength + settings.sawKerf) {
      const length = Math.min(settings.bedLength, sheet.length - x);
      if (length > minSide && width > minSide) pieces.push({ x, y, length, width });
    }
  }
  // The first piece is min(bed, Board) on both sides: the largest one.
  return pieces;
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

/** Nests as many Parts as fit on one piece, in order, with maxrects BSSF. */
function nest(piece: Piece, parts: Part[], settings: Settings): { placed: Placement[]; left: Part[] } {
  const usableL = piece.length - 2 * settings.clampMargin;
  const usableW = piece.width - 2 * settings.clampMargin;
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
    });
  }

  const numbered = [...placed]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p, i) => ({ n: i + 1, ...p }));
  return { placed: numbered, left };
}

/** A, B, ... Z, AA, AB, ... */
function blankLetter(index: number): string {
  let s = '';
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}
