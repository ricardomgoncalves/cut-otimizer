// The Job: a model, the Machine settings snapshot it was generated with, its Sheet code edits, its
// per-Part Saw / CNC choices and the Plan made from them. Everything a Job's files come from lives here,
// so changing the global settings changes nothing until the Job is regenerated. The stored form is the
// Job document (job-store/document.ts).
//
// Locked Boards and Blanks (those with a Part ticked Cut, so derived from the Job's progress) survive every
// re-plan here: `regenerate` and `addBoards` pass the stored Plan and the Cut Part ids to the Planner, which
// keeps Locked Blanks exactly as they are and Locked Boards' Breakdowns. A Locked Blank's Side A page is
// frozen first, so new settings (Side B files, Manual ops) don't rewrite it either. The Saw / CNC toggle and Sheet code
// edits only record the choice; the next Regenerate applies it.
import { freezeLockedPages } from './documents/index.ts';
import type { Model } from './model.ts';
import { blankLocked, boardLocked, discardOffcut, isLive, livePartIds, remakePart } from './plan-queries.ts';
import {
  partRule,
  plan,
  type Board,
  type PartMode,
  type Plan,
} from './planner/index.ts';
import { boardId, isCut, type Progress } from './progress.ts';
import type { Settings } from './settings.ts';

export interface Job {
  model: Model;
  /** The Machine settings snapshot, taken when the Job was last generated. */
  settings: Settings;
  /** Edited Sheet codes, by Sheet id. A Sheet not listed uses its derived code (`model.sheets[].code`). */
  sheetCodes: Record<string, string>;
  /** The Saw / CNC toggle, by Part id. Only choices that differ from the automatic rule are kept. */
  sawCnc: Record<string, PartMode>;
  /** Made from `model`, `settings`, `sheetCodes` and `sawCnc`. */
  plan: Plan;
}

/** Plans a model with a snapshot of `settings`. */
export function generateJob(
  model: Model,
  settings: Settings,
  sheetCodes: Record<string, string> = {},
  sawCnc: Record<string, PartMode> = {},
): Job {
  return planJob(model, settings, sheetCodes, sawCnc, null, {});
}

function planJob(
  model: Model,
  settings: Settings,
  sheetCodes: Record<string, string>,
  sawCnc: Record<string, PartMode>,
  prior: Plan | null,
  progress: Progress,
  addBoards: readonly string[] = [],
): Job {
  const snapshot: Settings = {
    ...settings,
    edgeTrimBySheet: { ...settings.edgeTrimBySheet },
    manualBottomOpKinds: [...settings.manualBottomOpKinds],
  };
  const cut = Object.keys(progress).filter((id) => isCut(progress, id));
  return {
    model,
    settings: snapshot,
    sheetCodes,
    sawCnc,
    plan: plan(
      withSheetCodes(model, sheetCodes),
      snapshot,
      prior ? { sawCnc, plan: freezeLockedPages(prior, model, (id) => isCut(progress, id)), cut, addBoards } : { sawCnc },
    ),
  };
}

/**
 * Re-plans the Job with the current global settings, which become its new snapshot. This is the explicit
 * "Regenerate": Locked Boards and Blanks (from `progress`) stay exactly as they are; everything else is
 * planned again, and new Boards take the next free numbers.
 */
export function regenerate(job: Job, settings: Settings, progress: Progress = {}): Job {
  return planJob(job.model, settings, job.sheetCodes, job.sawCnc, job.plan, progress);
}

/**
 * Agrees to more Boards for these Sheets: re-plans with the Job's own snapshot, so the Parts that needed
 * nesting but fit no kept Offcut or unlocked Board (`SheetPlan.overflow`) get new Boards.
 */
export function addBoards(job: Job, sheetIds: readonly string[], progress: Progress = {}): Job {
  return planJob(job.model, job.settings, job.sheetCodes, job.sawCnc, job.plan, progress, sheetIds);
}

/**
 * The Locked Boards of the Job's Plan (a Part on them ticked Cut, or a Remake Part greyed on them), with
 * their ids (`W18-1`).
 */
export function lockedBoards(job: Pick<Job, 'plan'>, progress: Progress): { id: string; sheetId: string; board: Board }[] {
  return job.plan.sheets.flatMap((sheet) =>
    sheet.boards
      .filter((b) => boardLocked(b, (id) => isCut(progress, id)))
      .map((board) => ({ id: boardId(sheet, board), sheetId: sheet.sheetId, board })),
  );
}

/**
 * Marks a ruined Part **Remake**: its ticks are cleared, it stays greyed out on its old Blank (which stays
 * Locked) and it needs nesting at the next regenerate. Only a Part ticked Cut can be remade.
 */
export function remake(job: Job, progress: Progress, partId: string): { job: Job; progress: Progress } | { error: string } {
  if (!job.model.parts.some((p) => p.id === partId)) return { error: `There is no Part ${partId} in this Job.` };
  const onBoard = job.plan.sheets.some((s) => s.boards.some((b) => livePartIds(b).includes(partId)));
  if (!isCut(progress, partId) || !onBoard) return { error: 'Only a Part already cut can be remade.' };
  return {
    job: { ...job, plan: remakePart(job.plan, partId) },
    progress: Object.fromEntries(Object.entries(progress).filter(([id]) => id !== partId)),
  };
}

/**
 * The Parts on no Board of the Plan (and not too big for one), in export order: Remakes not nested again
 * yet, and Parts waiting for a Board (`SheetPlan.overflow`). The next regenerate nests them.
 */
export function needsNesting(job: Pick<Job, 'model' | 'plan'>): string[] {
  const placed = new Set(job.plan.sheets.flatMap((s) => [...s.boards.flatMap(livePartIds), ...s.unplaced]));
  return job.model.parts.filter((p) => !placed.has(p.id)).map((p) => p.id);
}

/** The Parts of a Sheet that fit no kept Offcut and no unlocked Board, and the Boards adding them takes. */
export interface BoardRequest {
  sheetId: string;
  code: string;
  partIds: string[];
  /** The new Boards' numbers would run `first`–`last` (the Sheet then has `last` Boards). */
  first: number;
  last: number;
}

/**
 * What waits for nesting: Parts the next Regenerate nests (`waiting`: Remakes, Parts moved off Blanks), and
 * per Sheet the Parts that only fit if the person agrees to more Boards (`requests`, for `addBoards`).
 */
export function nestingQueue(job: Pick<Job, 'model' | 'plan'>): { waiting: string[]; requests: BoardRequest[] } {
  const overflow = new Set(job.plan.sheets.flatMap((s) => s.overflow ?? []));
  return {
    waiting: needsNesting(job).filter((id) => !overflow.has(id)),
    requests: job.plan.sheets
      .filter((s) => (s.overflow ?? []).length > 0)
      .map((s) => ({
        sheetId: s.sheetId,
        code: s.code,
        partIds: [...(s.overflow ?? [])],
        first: s.boards.length + 1,
        last: s.boards.length + Math.max(1, s.extraBoards ?? 1),
      })),
  };
}

/** Discards a kept Offcut (it is no longer stock for Parts that need nesting), or undoes that. */
export function setOffcutDiscarded(job: Job, offcutId: string, discarded: boolean): { job: Job } | { error: string } {
  const next = discardOffcut(job.plan, offcutId, discarded);
  const known = job.plan.sheets.some((s) => s.boards.some((b) => b.offcuts.some((o) => o.id === offcutId && o.kept && !o.used)));
  if (!known) return { error: `There is no kept Offcut ${offcutId} in this Job.` };
  return { job: { ...job, plan: next } };
}

/**
 * Sets a Part's Saw / CNC toggle. Nothing is re-planned: Regenerate is the only place where Blanks, Boards
 * and Offcuts change (PRD 3.5, 11.5), and it applies the choice (`pendingChoices`). Choosing the Part's
 * automatic mode removes the stored choice. A Part bigger than the usable bed, on a Locked
 * Blank or a Saw Part of a Locked Board can't be toggled.
 */
export function setPartMode(
  job: Job,
  partId: string,
  mode: PartMode,
  progress: Progress = {},
): { job: Job } | { error: string } {
  const rule = partRule(job.model, job.settings, partId);
  if (!rule) return { error: `There is no Part ${partId} in this Job.` };
  if (rule.oversize) {
    const tiling = job.settings.allowTiling ? ' Tiling only goes along X: it must fit the bed’s width.' : '';
    return { error: `This Part is bigger than the usable bed, so it is always cut on the saw.${tiling}` };
  }
  const cut = (id: string) => isCut(progress, id);
  for (const { id, board } of lockedBoards(job, progress)) {
    if (board.sawParts.some((p) => isLive(p) && p.partId === partId)) {
      return { error: `This Part is on Locked Board ${id}, so it stays where it is.` };
    }
    const blank = board.blanks.find((b) => blankLocked(b, cut) && b.parts.some((p) => isLive(p) && p.partId === partId));
    if (blank) return { error: `This Part is on Locked Blank ${blank.id}, so it stays where it is.` };
  }
  const sawCnc = Object.fromEntries(Object.entries(job.sawCnc).filter(([id]) => id !== partId));
  if (mode !== rule.auto) sawCnc[partId] = mode;
  return { job: { ...job, sawCnc } };
}

/** The Saw / CNC mode chosen for a Part (what the next Regenerate plans it as); null for an unknown Part. */
export function partMode(job: Pick<Job, 'model' | 'settings' | 'sawCnc'>, partId: string): PartMode | null {
  const rule = partRule(job.model, job.settings, partId);
  if (!rule) return null;
  return rule.oversize ? 'saw' : (job.sawCnc[partId] ?? rule.auto);
}

/** The Job's own choices the Plan doesn't show yet: they take effect at the next Regenerate. */
export interface PendingChoices {
  /** Parts whose Saw / CNC choice differs from how the Plan cuts them (Locked ones left out), export order. */
  partModes: string[];
  /** Sheets whose code differs from the one the Plan's Blank ids carry, Run order. */
  sheetCodes: string[];
}

export function pendingChoices(job: Job, progress: Progress): PendingChoices {
  const cut = (id: string) => isCut(progress, id);
  const fixed = new Set<string>();
  const inPlan = new Set<string>();
  for (const sheet of job.plan.sheets) {
    for (const id of [...sheet.unplaced, ...(sheet.overflow ?? [])]) inPlan.add(id);
    for (const board of sheet.boards) {
      const locked = boardLocked(board, cut);
      for (const p of board.sawParts.filter(isLive)) (locked ? fixed : inPlan).add(p.partId);
      for (const blank of board.blanks) {
        const target = locked && blankLocked(blank, cut) ? fixed : inPlan;
        for (const p of blank.parts.filter(isLive)) target.add(p.partId);
      }
    }
  }
  const sawInPlan = new Set(job.plan.sheets.flatMap((s) => s.sawParts));
  return {
    partModes: job.model.parts
      .filter((p) => inPlan.has(p.id) && !fixed.has(p.id))
      .filter((p) => partMode(job, p.id) !== (sawInPlan.has(p.id) ? 'saw' : 'cnc'))
      .map((p) => p.id),
    sheetCodes: job.plan.sheets.filter((s) => s.code !== sheetCode(job, s.sheetId)).map((s) => s.sheetId),
  };
}

/** The Sheet code in use for a Sheet: the edited one, else the derived one. */
export function sheetCode(job: Job, sheetId: string): string {
  return job.sheetCodes[sheetId] ?? job.model.sheets.find((s) => s.id === sheetId)?.code ?? '';
}

export const MAX_SHEET_CODE_LENGTH = 12;

/**
 * Edits a Sheet code (Job data, not a setting). Like the Saw / CNC toggle it re-plans nothing: the next
 * Regenerate gives the Sheet's Blanks the new code. The code is trimmed and uppercased; an empty code, or the derived one, goes back to the derived code.
 * A Sheet with Locked Boards keeps its code, because Locked Blanks keep their ids forever.
 */
export function setSheetCode(
  job: Job,
  sheetId: string,
  input: string,
  progress: Progress = {},
): { job: Job } | { error: string } {
  const sheet = job.model.sheets.find((s) => s.id === sheetId);
  if (!sheet) return { error: `There is no Sheet ${sheetId} in this Job.` };
  if (lockedBoards(job, progress).some((b) => b.sheetId === sheetId)) {
    return { error: `${sheetCode(job, sheetId)} has Locked Boards, so its code can no longer change.` };
  }
  const code = input.trim().toUpperCase();

  if (code !== '') {
    if (!/^[A-Z0-9]+$/.test(code)) return { error: 'A Sheet code may only hold letters and digits.' };
    if (code.length > MAX_SHEET_CODE_LENGTH) {
      return { error: `A Sheet code may be at most ${String(MAX_SHEET_CODE_LENGTH)} characters.` };
    }
    const clash = job.model.sheets.find((s) => s.id !== sheetId && sheetCode(job, s.id) === code);
    if (clash) return { error: `${code} is already the code of ${clash.name}.` };
  }

  const sheetCodes = Object.fromEntries(Object.entries(job.sheetCodes).filter(([id]) => id !== sheetId));
  if (code !== '' && code !== sheet.code) sheetCodes[sheetId] = code;
  return { job: { ...job, sheetCodes } };
}

function withSheetCodes(model: Model, codes: Record<string, string>): Model {
  return { ...model, sheets: model.sheets.map((s) => ({ ...s, code: codes[s.id] ?? s.code })) };
}
