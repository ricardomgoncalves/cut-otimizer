// The Job: a model, the Machine settings snapshot it was generated with, its Sheet code edits, its
// per-Part Saw / CNC choices and the Plan made from them. Everything a Job's files come from lives here,
// so changing the global settings changes nothing until the Job is regenerated. The stored form is the
// Job document (job-store/document.ts).
//
// Locked Boards and Blanks (those with a Part ticked Cut, so derived from the Job's progress) survive every
// re-plan here: `regenerate`, the Saw / CNC toggle and Sheet code edits pass the stored Plan and the Cut
// Part ids to the Planner, which keeps them exactly as they are.
import type { Model } from './model.ts';
import { partRule, plan, type Board, type PartMode, type Plan } from './planner/index.ts';
import { boardId, type Progress } from './progress.ts';
import { settingsChanges, type Settings } from './settings.ts';

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
): Job {
  const snapshot: Settings = {
    ...settings,
    edgeTrimBySheet: { ...settings.edgeTrimBySheet },
    manualBottomOpKinds: [...settings.manualBottomOpKinds],
  };
  const cut = Object.keys(progress).filter((id) => progress[id]?.cut !== undefined);
  return {
    model,
    settings: snapshot,
    sheetCodes,
    sawCnc,
    plan: plan(withSheetCodes(model, sheetCodes), snapshot, prior ? { sawCnc, plan: prior, cut } : { sawCnc }),
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

/** The Locked Boards of the Job's Plan (any Part on them ticked Cut), with their ids (`W18-1`). */
export function lockedBoards(job: Pick<Job, 'plan'>, progress: Progress): { id: string; sheetId: string; board: Board }[] {
  const isCut = (id: string) => progress[id]?.cut !== undefined;
  return job.plan.sheets.flatMap((sheet) =>
    sheet.boards
      .filter((b) => [...b.blanks.flatMap((x) => x.parts), ...b.sawParts].some((p) => isCut(p.partId)))
      .map((board) => ({ id: boardId(sheet, board), sheetId: sheet.sheetId, board })),
  );
}

/**
 * Sets a Part's Saw / CNC toggle and re-plans with the Job's own snapshot, keeping Locked Boards. Choosing
 * the Part's automatic mode removes the stored choice. A Part bigger than the usable bed, or on a Locked
 * Board, can't be toggled.
 */
export function setPartMode(
  job: Job,
  partId: string,
  mode: PartMode,
  progress: Progress = {},
): { job: Job } | { error: string } {
  const rule = partRule(job.model, job.settings, partId);
  if (!rule) return { error: `There is no Part ${partId} in this Job.` };
  if (rule.oversize) return { error: 'This Part is bigger than the usable bed, so it is always cut on the saw.' };
  const locked = lockedBoards(job, progress).find(({ board }) =>
    [...board.blanks.flatMap((b) => b.parts), ...board.sawParts].some((p) => p.partId === partId),
  );
  if (locked) return { error: `This Part is on Locked Board ${locked.id}, so it stays where it is.` };
  const sawCnc = Object.fromEntries(Object.entries(job.sawCnc).filter(([id]) => id !== partId));
  if (mode !== rule.auto) sawCnc[partId] = mode;
  return { job: planJob(job.model, job.settings, job.sheetCodes, sawCnc, job.plan, progress) };
}

/** The settings fields where the Job's snapshot differs from the current global settings. */
export function snapshotChanges(job: Job, current: Settings): (keyof Settings)[] {
  return settingsChanges(job.settings, current);
}

/** The Sheet code in use for a Sheet: the edited one, else the derived one. */
export function sheetCode(job: Job, sheetId: string): string {
  return job.sheetCodes[sheetId] ?? job.model.sheets.find((s) => s.id === sheetId)?.code ?? '';
}

export const MAX_SHEET_CODE_LENGTH = 12;

/**
 * Edits a Sheet code and re-plans with the Job's own snapshot (a code is Job data, not a setting).
 * The code is trimmed and uppercased; an empty code, or the derived one, goes back to the derived code.
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
  return { job: planJob(job.model, job.settings, sheetCodes, job.sawCnc, job.plan, progress) };
}

function withSheetCodes(model: Model, codes: Record<string, string>): Model {
  return { ...model, sheets: model.sheets.map((s) => ({ ...s, code: codes[s.id] ?? s.code })) };
}
