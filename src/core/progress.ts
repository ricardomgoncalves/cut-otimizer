// Progress: the Steps each Part goes through, the ticks made on them, and the roll-ups computed from
// those ticks (PRD stories 9.1, 9.2, 9.6 and 9.7). Ticks are keyed by Export Part id and stored in the
// Job document; roll-ups are always computed, never stored.
import type { Job } from './job.ts';
import { blankLocked, boardLocked, isLive, livePartIds } from './plan-queries.ts';
import type { Blank, Board, SheetPlan } from './planner/index.ts';

/** One tracked stage of a Part, in Run order. */
export type Step = 'cut' | 'sideB' | 'banded' | 'manualOps';

export const STEPS: readonly Step[] = ['cut', 'sideB', 'banded', 'manualOps'];

/** What the Progress module reads from a Job. */
export type JobView = Pick<Job, 'model' | 'plan'>;

/** When each ticked Step was ticked (ISO 8601), by Export Part id. A Part with no ticks has no entry. */
export type Progress = Record<string, PartTicks>;
export type PartTicks = Partial<Record<Step, string>>;

/** A change to the ticks. Bulk events tick only the Parts and Steps they name, and keep earlier times. */
export type ProgressEvent =
  | { kind: 'tick'; partId: string; step: Step; at: string }
  | { kind: 'untick'; partId: string; step: Step }
  /** "Side A done": Cut on every Part of a Blank. */
  | { kind: 'sideADone'; blankId: string; at: string }
  /** "Breakdown done": Cut on every Saw Part of a Board. */
  | { kind: 'breakdownDone'; boardId: string; at: string }
  /** Side B on every Part of a Side B file. */
  | { kind: 'sideBDone'; fileId: string; at: string };

/** Applies one event. Steps that don't apply to a Part, and unknown Parts, are ignored. */
export function apply(job: JobView, progress: Progress, event: ProgressEvent): Progress {
  switch (event.kind) {
    case 'tick':
      return tick(job, progress, [event.partId], event.step, event.at);
    case 'untick': {
      const ticks = progress[event.partId];
      if (ticks?.[event.step] === undefined) return progress;
      const rest: PartTicks = Object.fromEntries(Object.entries(ticks).filter(([step]) => step !== event.step));
      const out: Progress = Object.fromEntries(Object.entries(progress).filter(([id]) => id !== event.partId));
      if (Object.keys(rest).length > 0) out[event.partId] = rest;
      return out;
    }
    case 'sideADone': {
      const blank = boards(job).flatMap((b) => b.board.blanks).find((b) => b.id === event.blankId);
      return tick(job, progress, blank ? blankParts(blank) : [], 'cut', event.at);
    }
    case 'breakdownDone': {
      const board = boards(job).find((b) => b.id === event.boardId);
      return tick(job, progress, board?.board.sawParts.filter(isLive).map((p) => p.partId) ?? [], 'cut', event.at);
    }
    case 'sideBDone': {
      const file = job.plan.sideB.find((f) => f.id === event.fileId);
      return tick(job, progress, file?.partIds ?? [], 'sideB', event.at);
    }
  }
}

/** A Board's id: `<Sheet code>-<Board number>` (`W18-1`), the prefix of its Blank ids. */
export function boardId(sheet: Pick<SheetPlan, 'code'>, board: Pick<Board, 'number'>): string {
  return `${sheet.code}-${String(board.number)}`;
}

interface BoardRef {
  id: string;
  sheet: SheetPlan;
  board: Board;
}

function boards(job: JobView): BoardRef[] {
  return job.plan.sheets.flatMap((sheet) => sheet.boards.map((board) => ({ id: boardId(sheet, board), sheet, board })));
}

/** Every Part cut from a Board now: its Blanks' Parts, then its Saw Parts (Remake Parts greyed there left out). */
const boardParts = livePartIds;

/** A Blank's Parts, leaving out Remake Parts greyed on it. */
function blankParts(blank: Blank): string[] {
  return blank.parts.filter(isLive).map((p) => p.partId);
}

function tick(job: JobView, progress: Progress, partIds: readonly string[], step: Step, at: string): Progress {
  let out = progress;
  for (const partId of partIds) {
    if (progress[partId]?.[step] !== undefined || !steps(job, partId).includes(step)) continue;
    if (out === progress) out = { ...progress };
    out[partId] = { ...progress[partId], [step]: at };
  }
  return out;
}

/** A Part is Done when every Step that applies to it is ticked. */
export function isDone(job: JobView, progress: Progress, partId: string): boolean {
  const ticks = progress[partId];
  const applicable = steps(job, partId);
  return applicable.length > 0 && applicable.every((s) => ticks?.[s] !== undefined);
}

/** Whether the Part is ticked Cut: what Locks its Blank and Board. */
export function isCut(progress: Progress | undefined, partId: string): boolean {
  return progress?.[partId]?.cut !== undefined;
}

export interface BlankProgress {
  id: string;
  cut: number;
  done: number;
  total: number;
  /** At least one Part ticked Cut. */
  locked: boolean;
}

export interface BoardProgress {
  /** `W18-1`. */
  id: string;
  sheetId: string;
  /** Its Blanks' Parts and its Saw Parts. */
  cut: number;
  total: number;
  /** Its Saw Parts alone ("Breakdown done"). */
  sawCut: number;
  sawTotal: number;
  locked: boolean;
}

export interface SideBProgress {
  /** `B1`. */
  id: string;
  /** Parts ticked Side B. */
  done: number;
  total: number;
}

export interface SheetProgress {
  sheetId: string;
  code: string;
  /** Every Part of the Sheet, including Saw Parts on no Board. */
  cut: number;
  total: number;
}

export interface OwnerProgress {
  ownerId: string;
  kind: 'cabinet' | 'generatedItem';
  label: string;
  done: number;
  total: number;
  /** Cabinets only: every Part Done. Always false for a Generated Item. */
  readyToAssemble: boolean;
}

export interface Rollup {
  /** In Run order. */
  blanks: BlankProgress[];
  /** In Run order. */
  boards: BoardProgress[];
  /** In Run order. */
  sheets: SheetProgress[];
  /** In file order. */
  sideB: SideBProgress[];
  /** Cabinets, then Generated Items, in export order. Owners without Parts are left out. */
  owners: OwnerProgress[];
  job: { cut: number; done: number; total: number };
}

/** Every roll-up of the Job, computed from the ticks. */
export function rollup(job: JobView, progress: Progress): Rollup {
  const done = new Set(job.model.parts.filter((p) => isDone(job, progress, p.id)).map((p) => p.id));
  const cutOf = (ids: readonly string[]) => ids.filter((id) => isCut(progress, id)).length;

  const blanks: BlankProgress[] = [];
  const boardRows: BoardProgress[] = [];
  const cutNow = (id: string) => isCut(progress, id);
  for (const { id, sheet, board } of boards(job)) {
    for (const blank of board.blanks) {
      const ids = blankParts(blank);
      blanks.push({
        id: blank.id,
        cut: cutOf(ids),
        done: ids.filter((i) => done.has(i)).length,
        total: ids.length,
        locked: blankLocked(blank, cutNow),
      });
    }
    const ids = boardParts(board);
    const saw = board.sawParts.filter(isLive).map((p) => p.partId);
    boardRows.push({
      id,
      sheetId: sheet.sheetId,
      cut: cutOf(ids),
      total: ids.length,
      sawCut: cutOf(saw),
      sawTotal: saw.length,
      locked: boardLocked(board, cutNow),
    });
  }

  const sheets = job.plan.sheets.map((sheet): SheetProgress => {
    // Every Part of the Sheet: on a Board, too big for one, or waiting to be nested (Remake, overflow).
    const ids = job.model.parts.filter((p) => p.sheetId === sheet.sheetId).map((p) => p.id);
    return { sheetId: sheet.sheetId, code: sheet.code, cut: cutOf(ids), total: ids.length };
  });

  const owners = [...job.model.owners]
    .sort((a, b) => Number(a.kind === 'generatedItem') - Number(b.kind === 'generatedItem'))
    .flatMap((owner): OwnerProgress[] => {
      const ids = job.model.parts.filter((p) => p.ownerId === owner.id).map((p) => p.id);
      if (ids.length === 0) return [];
      const ownerDone = ids.filter((i) => done.has(i)).length;
      return [
        {
          ownerId: owner.id,
          kind: owner.kind,
          label: owner.label,
          done: ownerDone,
          total: ids.length,
          readyToAssemble: owner.kind === 'cabinet' && ownerDone === ids.length,
        },
      ];
    });

  const sideB = job.plan.sideB.map((f): SideBProgress => ({
    id: f.id,
    done: f.partIds.filter((id) => progress[id]?.sideB !== undefined).length,
    total: f.partIds.length,
  }));

  const all = job.model.parts.map((p) => p.id);
  return { blanks, boards: boardRows, sheets, sideB, owners, job: { cut: cutOf(all), done: done.size, total: all.length } };
}

/**
 * The Blank and Board ids (in that order) that unticking this Step would unlock: those whose only Part
 * ticked Cut is this one. Empty for any Step but Cut.
 */
export function wouldUnlock(job: JobView, progress: Progress, partId: string, step: Step): string[] {
  if (step !== 'cut' || !isCut(progress, partId)) return [];
  const othersCut = (id: string) => id !== partId && isCut(progress, id);
  const out: string[] = [];
  for (const { id, board } of boards(job)) {
    if (!boardParts(board).includes(partId)) continue;
    const blank = board.blanks.find((b) => blankParts(b).includes(partId));
    if (blank && !blankLocked(blank, othersCut)) out.push(blank.id);
    if (!boardLocked(board, othersCut)) out.push(id);
  }
  return out;
}

/** What to print again after a regenerate: everything that isn't Locked or Done. Ids in Run order. */
export interface ReprintSelection {
  /** Board ids (`W18-1`) of unlocked Boards: their saw pages. */
  boards: string[];
  /** Ids of unlocked Blanks (also those on a Locked Board): their Side A pages and DXFs. */
  blanks: string[];
  /**
   * Parts not Done that are on no Locked Blank and aren't Saw Parts of a Locked Board (incl. Saw Parts on
   * no Board): their labels and rows.
   */
  parts: string[];
  /** Side B files holding any of those Parts. */
  sideB: string[];
}

/**
 * The PDF pages and labels a regenerate needs reprinted: Locked Boards and Blanks are unchanged by a
 * regenerate, so their paper (and the labels of the Parts on them) is still good.
 */
export function reprintSelection(job: JobView, progress: Progress): ReprintSelection {
  const out: ReprintSelection = { boards: [], blanks: [], parts: [], sideB: [] };
  const keep = (ids: readonly string[]) => ids.filter((id) => !isDone(job, progress, id));
  const cut = (id: string) => isCut(progress, id);
  for (const sheet of job.plan.sheets) {
    for (const board of sheet.boards) {
      // A Locked Board keeps its Breakdown (saw page, Saw Parts), but its uncut Blanks are nested again.
      if (boardLocked(board, cut)) {
        for (const blank of board.blanks.filter((b) => !blankLocked(b, cut))) {
          out.blanks.push(blank.id);
          out.parts.push(...keep(blankParts(blank)));
        }
        continue;
      }
      out.boards.push(boardId(sheet, board));
      out.blanks.push(...board.blanks.map((b) => b.id));
      out.parts.push(...keep(boardParts(board)));
    }
    // On no Board: too big for one, or waiting for nesting (a Remake not yet re-nested, overflow).
    const live = new Set(job.plan.sheets.flatMap((s) => s.boards.flatMap(boardParts)));
    const waiting = job.model.parts.filter((p) => p.sheetId === sheet.sheetId && !live.has(p.id)).map((p) => p.id);
    out.parts.push(...keep(waiting));
  }
  const parts = new Set(out.parts);
  out.sideB = job.plan.sideB.filter((f) => f.partIds.some((id) => parts.has(id))).map((f) => f.id);
  return out;
}

/** The Steps that apply to a Part, in Step order. Empty for a Part that isn't in the Job. */
export function steps(job: JobView, partId: string): Step[] {
  const part = job.model.parts.find((p) => p.id === partId);
  if (!part) return [];
  const out: Step[] = ['cut'];
  if (job.plan.sideB.some((f) => f.partIds.includes(partId))) out.push('sideB');
  if (Object.values(part.edges).some((id) => id !== undefined)) out.push('banded');
  if (job.plan.manualOps.some((op) => op.partId === partId)) out.push('manualOps');
  return out;
}

/** Old Export Part id -> new one, recorded by re-import. Permanent: old stickers keep scanning. */
export type IdAliases = Record<string, string>;

/**
 * Follows the alias table from an old Part id to the id the Part has now (an id with no alias is its
 * own). Chains from several re-imports are followed; a cycle stops where it started.
 */
export function resolveAlias(aliases: IdAliases, partId: string): string {
  const seen = new Set<string>();
  let id = partId;
  while (Object.hasOwn(aliases, id) && !seen.has(id)) {
    seen.add(id);
    id = aliases[id] ?? id;
  }
  return id;
}

/** What a scan needs to know about the open Job besides its Plan. */
export interface ScanJob {
  /** The Job's short id: the first half of every label's payload. */
  shortId: string;
  aliases: IdAliases;
}

/** A label's QR payload: `<job short id>:<Part id>`. */
export function scanPayload(shortId: string, partId: string): string {
  return `${shortId}:${partId}`;
}

export type ScanOutcome =
  /** Nothing ticked: not a payload, another Job's label, or a Part this Job doesn't have. */
  | { kind: 'rejected'; reason: 'unreadable' | 'otherJob' | 'unknownPart'; payload: string }
  /** Nothing ticked: the Part has no such Step, or it is already ticked. */
  | { kind: 'notTicked'; reason: 'noSuchStep' | 'alreadyTicked'; partId: string; step: Step }
  /** Ticked. `openEarlier` = the Part's Steps before this one that are still open (a warning). */
  | { kind: 'ticked'; partId: string; step: Step; progress: Progress; openEarlier: Step[] };

/** Scan mode: ticks `step` on the Part a scanned payload names, by the Scan-mode rules. */
export function scan(
  job: JobView,
  scanJob: ScanJob,
  progress: Progress,
  { payload, step, at }: { payload: string; step: Step; at: string },
): ScanOutcome {
  const text = payload.trim();
  const colon = text.indexOf(':');
  if (colon <= 0 || colon === text.length - 1) return { kind: 'rejected', reason: 'unreadable', payload };
  if (text.slice(0, colon).toUpperCase() !== scanJob.shortId.toUpperCase()) {
    return { kind: 'rejected', reason: 'otherJob', payload };
  }
  const partId = resolveAlias(scanJob.aliases, text.slice(colon + 1));
  const applicable = steps(job, partId);
  if (applicable.length === 0) return { kind: 'rejected', reason: 'unknownPart', payload };
  if (!applicable.includes(step)) return { kind: 'notTicked', reason: 'noSuchStep', partId, step };
  const ticks = progress[partId];
  if (ticks?.[step] !== undefined) return { kind: 'notTicked', reason: 'alreadyTicked', partId, step };
  const openEarlier = applicable.slice(0, applicable.indexOf(step)).filter((s) => ticks?.[s] === undefined);
  return { kind: 'ticked', partId, step, progress: apply(job, progress, { kind: 'tick', partId, step, at }), openEarlier };
}
