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
// - Only `top` ops go to Side A. Flip Parts, Side B files and Manual ops: side-b.ts (#28).
// - Locked Boards (#36; PRD 3.7, 5.5): a Board of `prior.plan` with any Part ticked Cut (`prior.cut`) is
//   kept exactly as it is (geometry, number, Blank ids, `#n`, its Saw Parts with their reasons), with every
//   Part on it. Only the other Parts are planned, onto new Boards numbered after the highest Locked Board,
//   so new Blanks never reuse a Locked id and sort to the end of their Sheet. Each Blank records the clamp
//   margin it was nested with, so a Locked Blank's DXF doesn't change when the margin does.
import { MaxRectsBin, PACKING_LOGIC, Rectangle } from 'maxrects-packer';
import type { CncOp, Model, Part, Sheet } from '../model.ts';
import { edgeTrimFor, type Settings } from '../settings.ts';
import { sideB, type JobManualOp, type SideBFile } from './side-b.ts';

export { sideB, sideBPoint, type Edge, type JobManualOp, type QuarterTurns, type SideBFile } from './side-b.ts';

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
  /**
   * Marked Remake: the Part was cut here and ruined. It stays where it was (greyed out), so its Locked
   * Blank and its DXF don't change, but it is planned again elsewhere and counts nowhere here.
   */
  remade?: boolean;
  /**
   * A void left on a Locked Blank by a re-import (#39): the Part `moved` (changed before it was cut, so
   * nested again elsewhere), was `removed` from the export before it was cut, or is now a `spare` (removed
   * after it was cut). Like a Remake it stays greyed where it was, so the Blank's DXF and PDF page don't
   * change, and counts nowhere here.
   */
  voided?: VoidReason;
}

/** Why a Placement is a void (see `Placement.voided`). */
export type VoidReason = 'moved' | 'removed' | 'spare';

/** A Placement or Saw Part that is cut here now: not a greyed Remake and not a void. */
export function isLive(p: { remade?: boolean; voided?: VoidReason }): boolean {
  return p.remade !== true && p.voided === undefined;
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
  /** Cut from this kept Offcut of its (Locked) Board at a later regenerate, e.g. `W18-1-K1`. */
  from?: string;
  /**
   * The clamp margin its Parts were nested inside. The Planner always sets it, so a Locked Blank kept
   * from an earlier Plan keeps its own margin; a hand-written Blank without it uses `plan.settings`.
   */
  clampMargin?: number;
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
  /** Marked Remake: stays here greyed out, and is planned again elsewhere. */
  remade?: boolean;
  /** A void left by a re-import on a Locked Board (see `Placement.voided`). */
  voided?: VoidReason;
}

/**
 * A leftover piece of the Breakdown. `kept` when at least Min Offcut size on both sides: then it has an
 * id (`W18-1-K1`) and is stock for Parts that need nesting, while its Board is Locked.
 */
export interface Offcut {
  /** Kept Offcuts only: `<Board id>-K<n>`, numbered per Board in saw order. */
  id?: string;
  x: number;
  y: number;
  length: number;
  width: number;
  kept: boolean;
  /** Kept, but set aside by hand (undoable): no longer stock. */
  discarded?: boolean;
  /** Cut up for new Blanks at a regenerate: what is left of it is listed as Offcuts of its own. */
  used?: boolean;
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
  /** A saw entry of its own, cutting up this kept Offcut (`W18-1-K1`) at a later regenerate. */
  from?: string;
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
  /**
   * Parts that need nesting but fit neither a kept Offcut of a Locked Board nor the Sheet's unlocked
   * Boards: on no Board until the person agrees to add Boards (`PlanPrior.addBoards`). Export order.
   */
  overflow?: string[];
  /** How many Boards adding them would take (0 when `overflow` is empty). */
  extraBoards?: number;
}

export interface Plan {
  /** The settings the Plan was made with (the DXF writer reads the clamp margin from here). */
  settings: Settings;
  /** In Run order: grouped by thickness, groups and Sheets in export order. */
  sheets: SheetPlan[];
  /** Side B files, in Run order of their first Part (ticket #28). */
  sideB: SideBFile[];
  /** Every Manual op of the Job, by Part in Run order. */
  manualOps: JobManualOp[];
}

export type PartMode = 'saw' | 'cnc';

/** What the Planner keeps from earlier: the Job's choices, the stored Plan and what is already cut. */
export interface PlanPrior {
  /** Per-Part Saw / CNC toggle, by Part id. Ignored for Parts bigger than the usable bed and for Locked Parts. */
  sawCnc?: Record<string, PartMode>;
  /** The stored Plan. Its Locked Boards are kept exactly as they are. */
  plan?: Plan;
  /**
   * Part ids ticked Cut. A Board of `plan` with any of them on it (on a Blank or as a Saw Part) is
   * **Locked**: kept with its geometry, Board number, Blank ids and `#n`, and with every Part on it.
   */
  cut?: readonly string[];
  /**
   * Sheet ids that may get more Boards than `plan` gave them. Parts that need nesting (on no Board of
   * `plan`: Remakes, Added Parts…) go first onto kept, non-discarded Offcuts of Locked Boards, then into
   * the Breakdown of the Sheet's unlocked Boards; a Sheet only gets more Boards than that when listed
   * here. A Sheet with no Boards in `plan` (or no `plan`) always gets its Boards.
   */
  addBoards?: readonly string[];
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
  const locked = lockedBoards(prior);
  const live = prior.plan ? new Set(prior.plan.sheets.flatMap((s) => [...s.boards.flatMap(livePartIds), ...s.unplaced])) : null;
  const sheets = runOrder(model.sheets).map((sheet) => {
    const before = prior.plan?.sheets.find((s) => s.sheetId === sheet.id);
    return planSheet(sheet, model.parts.filter((p) => p.sheetId === sheet.id), settings, {
      sawCnc: prior.sawCnc ?? {},
      locked: locked.get(sheet.id) ?? [],
      live,
      // A Sheet without Boards so far is brand-new: it gets its Boards without asking.
      boardsBefore: before && before.boards.length > 0 && !prior.addBoards?.includes(sheet.id) ? before.boards.length : null,
    });
  });
  const { files, manualOps } = sideB(model, settings, partRunOrder(sheets));
  return { settings, sheets, sideB: files, manualOps };
}

/** The Locked Boards of the prior Plan, by Sheet id, in Board-number order. */
function lockedBoards(prior: PlanPrior): Map<string, Board[]> {
  const cut = new Set(prior.cut ?? []);
  const out = new Map<string, Board[]>();
  for (const sheet of prior.plan?.sheets ?? []) {
    const boards = sheet.boards.filter((b) => boardLocked(b, (id) => cut.has(id))).sort((a, b) => a.number - b.number);
    if (boards.length > 0) out.set(sheet.sheetId, boards);
  }
  return out;
}

/** The Parts a Board gives now: its Blanks' Parts, then its Saw Parts, leaving out Remakes and voids (greyed). */
export function livePartIds(board: Board): string[] {
  return [
    ...board.blanks.flatMap((b) => b.parts.filter(isLive).map((p) => p.partId)),
    ...board.sawParts.filter(isLive).map((p) => p.partId),
  ];
}

/**
 * Locked: a Part on it is ticked Cut, or a Remake Part was cut from it. A Remake clears the Part's ticks
 * but its old Blank stays Locked.
 */
export function boardLocked(board: Board, isCut: (partId: string) => boolean): boolean {
  return board.blanks.some((b) => blankLocked(b, isCut)) || board.sawParts.some((p) => p.remade === true || isCut(p.partId));
}

/** A Blank with a Part ticked Cut, or a Remake Part on it. */
export function blankLocked(blank: Blank, isCut: (partId: string) => boolean): boolean {
  return blank.parts.some((p) => p.remade === true || isCut(p.partId));
}

/**
 * Marks a Part **Remake** in a Plan: where it is on a Board now, it stays greyed out (`remade`), and the
 * next plan nests it again. Unchanged when the Part is on no Board.
 */
export function remakePart(plan: Plan, partId: string): Plan {
  const mark = <T extends { partId: string; remade?: boolean; voided?: VoidReason }>(p: T): T =>
    p.partId === partId && isLive(p) ? { ...p, remade: true } : p;
  return mapBoards(plan, (board) =>
    livePartIds(board).includes(partId)
      ? {
          ...board,
          blanks: board.blanks.map((b) => ({ ...b, parts: b.parts.map(mark) })),
          sawParts: board.sawParts.map(mark),
        }
      : board,
  );
}

/** Discards a kept Offcut (no longer stock), or undoes that. Unchanged for an unknown or used Offcut. */
export function discardOffcut(plan: Plan, offcutId: string, discarded: boolean): Plan {
  return mapBoards(plan, (board) =>
    board.offcuts.some((o) => o.id === offcutId && o.kept && !o.used)
      ? {
          ...board,
          offcuts: board.offcuts.map((o) => {
            if (o.id !== offcutId) return o;
            const rest: Offcut = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'discarded')) as Offcut;
            return discarded ? { ...rest, discarded: true } : rest;
          }),
        }
      : board,
  );
}

function mapBoards(plan: Plan, f: (board: Board) => Board): Plan {
  let changed = false;
  const sheets = plan.sheets.map((sheet) => {
    const boards = sheet.boards.map((b) => {
      const out = f(b);
      if (out !== b) changed = true;
      return out;
    });
    return boards.some((b, i) => b !== sheet.boards[i]) ? { ...sheet, boards } : sheet;
  });
  return changed ? { ...plan, sheets } : plan;
}

/**
 * Every Part id in Run order: per Sheet and Board, the Blanks' Parts (letter, then `#n`), then the Board's
 * Saw Parts; Saw Parts too big for any Board last in their Sheet.
 */
function partRunOrder(sheets: SheetPlan[]): string[] {
  return sheets.flatMap((sheet) => [...sheet.boards.flatMap(livePartIds), ...sheet.unplaced, ...(sheet.overflow ?? [])]);
}

/** The Saw / CNC rule for one Part of the model. */
export function partRule(model: Model, settings: Settings, partId: string): PartRule | null {
  const part = model.parts.find((p) => p.id === partId);
  const sheet = model.sheets.find((s) => s.id === part?.sheetId);
  if (!part || !sheet) return null;
  return ruleFor(part, sheet, settings);
}

function ruleFor(part: Part, sheet: Sheet, settings: Settings): PartRule {
  const { length, width } = largestPiece(trimmedArea(sheet, settings), settings);
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

/** The largest Blank an area (a trimmed Board, or a kept Offcut) gives: the bed, or the area if smaller. */
function largestPiece(a: Area, settings: Settings) {
  return {
    length: Math.min(settings.bedLength, a.x1 - a.x0),
    width: Math.min(settings.bedWidth, a.y1 - a.y0),
  };
}

interface SawItem {
  part: Part;
  reason: SawReason;
}

interface SheetPrior {
  sawCnc: Record<string, PartMode>;
  locked: Board[];
  /** Part ids on a Board (not greyed) or too big for one in the prior Plan; null without a prior Plan. */
  live: Set<string> | null;
  /** How many Boards the Sheet had, when it may not get more without asking; null when it may. */
  boardsBefore: number | null;
}

function planSheet(sheet: Sheet, parts: Part[], settings: Settings, prior: SheetPrior): SheetPlan {
  const { sawCnc, locked } = prior;
  // Parts on a Locked Board stay where they are; a Locked Saw Part keeps its reason.
  const lockedSaw = new Map(
    locked.flatMap((b) => b.sawParts.filter(isLive).map((p) => [p.partId, p.reason] as const)),
  );
  const lockedIds = new Set(locked.flatMap(livePartIds));
  const cnc: Part[] = [];
  const saw: SawItem[] = [];
  const sawReasons: Record<string, SawReason> = {};
  const sawParts: string[] = [];
  for (const part of parts) {
    const keptReason = lockedSaw.get(part.id);
    if (keptReason) {
      sawParts.push(part.id);
      sawReasons[part.id] = keptReason;
    }
    if (lockedIds.has(part.id)) continue;
    const rule = ruleFor(part, sheet, settings);
    const choice = sawCnc[part.id];
    if (rule.oversize) saw.push({ part, reason: 'oversize' });
    else if (choice === 'cnc') cnc.push(part);
    else if (choice === 'saw') saw.push({ part, reason: rule.auto === 'saw' ? 'narrow' : 'chosen' });
    else if (rule.auto === 'saw') saw.push({ part, reason: 'narrow' });
    else cnc.push(part);
    const item = saw[saw.length - 1];
    if (item?.part === part) {
      sawParts.push(part.id);
      sawReasons[part.id] = item.reason;
    }
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
  // Parts on no Board of the prior Plan need nesting: Remakes, Parts added since…
  const needs = new Set(prior.live ? parts.filter((p) => !prior.live?.has(p.id)).map((p) => p.id) : []);

  // 1. Kept, non-discarded Offcuts of Locked Boards, for the CNC Parts that need nesting.
  const onOffcuts = new Set<string>();
  const boards = locked.map((board) => {
    let out = board;
    let waiting = nestingOrder(cnc.filter((p) => needs.has(p.id) && !onOffcuts.has(p.id)));
    for (let i = 0; i < out.offcuts.length && waiting.length > 0; i++) {
      const offcut = out.offcuts[i];
      if (!offcut?.id || !offcut.kept || offcut.used || offcut.discarded) continue;
      const offCtx: Ctx = {
        ...ctx,
        area: { x0: offcut.x, y0: offcut.y, x1: offcut.x + offcut.length, y1: offcut.y + offcut.width },
      };
      const draft = bestBoard(offCtx, waiting, []);
      if (!draft) continue;
      out = cutOffcut(offCtx, out, offcut.id, draft);
      for (const id of draftPartIds(draft)) onOffcuts.add(id);
      waiting = waiting.filter((p) => !onOffcuts.has(p.id));
    }
    return out;
  });

  // 2. The Breakdown of the Sheet's unlocked Boards, with every other Part not on a Locked Board.
  const cncLeft = cnc.filter((p) => !onOffcuts.has(p.id));
  const sawLeft = saw.filter((s) => fitsBoard(s.part));
  const all = draftBoards(ctx, cncLeft, sawLeft);
  let chosen = all;
  let overflow: string[] = [];
  let extraBoards = 0;
  if (prior.boardsBefore !== null && needs.size > 0) {
    // 3. More Boards than the Sheet had (or than its other Parts need now) only when the person agrees.
    const regular = draftBoards(
      ctx,
      cncLeft.filter((p) => !needs.has(p.id)),
      sawLeft.filter((s) => !needs.has(s.part.id)),
    );
    const allowed = Math.max(regular.length, prior.boardsBefore - locked.length);
    if (all.length > allowed) {
      const beyond = all.slice(allowed).flatMap(draftPartIds);
      chosen = beyond.every((id) => needs.has(id)) ? all.slice(0, allowed) : regular;
      const placed = new Set(chosen.flatMap(draftPartIds));
      const left = [...cncLeft.map((p) => p.id), ...sawLeft.map((s) => s.part.id)];
      const waiting = new Set(left.filter((id) => !placed.has(id)));
      overflow = parts.filter((p) => waiting.has(p.id)).map((p) => p.id);
      extraBoards = all.length - allowed;
    }
  }

  // New Boards take the next free numbers, after every Locked Board, so they sort last in the Sheet.
  const first = Math.max(0, ...locked.map((b) => b.number));
  boards.push(...chosen.map((draft, i) => finishBoard(ctx, draft, first + i + 1)));

  return {
    sheetId: sheet.id,
    code: sheet.code,
    thickness: sheet.thickness,
    boards,
    sawParts,
    sawReasons,
    unplaced,
    overflow,
    extraBoards,
  };
}

/** Plans Boards one after another until every Part is on one. */
function draftBoards(ctx: Ctx, cncIn: Part[], sawIn: SawItem[]): DraftBoard[] {
  let cnc = nestingOrder(cncIn);
  let saw = sawOrder(sawIn);
  const out: DraftBoard[] = [];
  while (cnc.length > 0 || saw.length > 0) {
    const draft = bestBoard(ctx, cnc, saw);
    if (!draft) break; // Cannot happen: every remaining Part fits an empty Board.
    out.push(draft);
    const used = new Set(draftPartIds(draft));
    cnc = cnc.filter((p) => !used.has(p.id));
    saw = saw.filter((s) => !used.has(s.part.id));
  }
  return out;
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
  const piece = largestPiece(ctx.area, settings);
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

/** Gives kept Offcuts their ids `<board>-K<n>`, numbering on from `last`. */
function withOffcutIds(offcuts: Offcut[], board: string, last: number): Offcut[] {
  let n = last;
  return offcuts.map((o) => (o.kept ? { id: `${board}-K${String(++n)}`, ...o } : o));
}

/** Letters the Blanks in saw order, numbers the cuts and lists the Offcuts. */
function finishBoard(ctx: Ctx, draft: DraftBoard, number: number): Board {
  const { sheet } = ctx;
  const prefix = `${sheet.code}-${String(number)}`;
  const { blanks, sawParts, cuts } = breakDown(ctx, draft, { prefix, letters: 0, label: '' });
  return {
    number,
    length: sheet.length,
    width: sheet.width,
    blanks,
    sawParts,
    offcuts: withOffcutIds(offcutsOf(ctx, draft), prefix, 0),
    cuts,
  };
}

/**
 * Cuts a kept Offcut of a Locked Board (`ctx.area`) into the Blanks of `draft`. The new Blanks continue
 * the Board's letters, their cuts are saw entries of their own (`K1.1`, `K1.1a`… from the Offcut's
 * edges), the Offcut is marked used and what is left of it becomes new Offcuts (kept ones numbered on).
 */
function cutOffcut(ctx: Ctx, board: Board, offcutId: string, draft: DraftBoard): Board {
  const prefix = offcutId.slice(0, offcutId.lastIndexOf('-'));
  const short = offcutId.slice(prefix.length + 1);
  const { blanks, sawParts, cuts } = breakDown(ctx, draft, {
    prefix,
    letters: board.blanks.length,
    label: `${short}.`,
    from: offcutId,
  });
  const lastK = Math.max(0, ...board.offcuts.map((o) => Number(/-K(\d+)$/.exec(o.id ?? '')?.[1] ?? 0)));
  return {
    ...board,
    blanks: [...board.blanks, ...blanks],
    sawParts: [...board.sawParts, ...sawParts],
    offcuts: [
      ...board.offcuts.map((o) => (o.id === offcutId ? { ...o, used: true } : o)),
      ...withOffcutIds(offcutsOf(ctx, draft), prefix, lastK),
    ],
    cuts: [...board.cuts, ...cuts],
  };
}

/** The Blanks, Saw Parts and cuts of a draft, inside `ctx.area`, in saw order. */
function breakDown(
  ctx: Ctx,
  draft: DraftBoard,
  naming: { prefix: string; letters: number; label: string; from?: string },
): Pick<Board, 'blanks' | 'sawParts' | 'cuts'> {
  const { area } = ctx;
  const from = naming.from === undefined ? {} : { from: naming.from };
  const blanks: Blank[] = [];
  const sawParts: SawPlacement[] = [];
  const cuts: Cut[] = [];

  draft.strips.forEach((strip, i) => {
    const rip = naming.label + String(i + 1);
    if (strip.y + strip.width < area.y1) {
      cuts.push({ label: rip, kind: 'rip', x: area.x0, y: strip.y + strip.width, length: area.x1 - area.x0, ...from });
    }
    strip.pieces.forEach((piece, j) => {
      const end = piece.x + piece.length;
      if (end < area.x1) {
        cuts.push({ label: rip + crossLetter(j), kind: 'cross', x: end, y: strip.y, length: strip.width, ...from });
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
      const letter = blankLetter(naming.letters + blanks.length);
      const parts = [...piece.placed]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((p, k) => ({ n: k + 1, ...p }));
      blanks.push({
        id: `${naming.prefix}-${letter}`,
        letter,
        x: piece.x,
        y: strip.y,
        length: piece.length,
        width: strip.width,
        ...from,
        clampMargin: ctx.settings.clampMargin,
        parts,
      });
    });
  });
  return { blanks, sawParts, cuts };
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
