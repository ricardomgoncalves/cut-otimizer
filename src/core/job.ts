// The Job: a model, the Machine settings snapshot it was generated with, its Sheet code edits and the
// Plan made from them. Everything a Job's files come from lives here, so changing the global settings
// changes nothing until the Job is regenerated. (The Job store and its document format are ticket #29.)
import type { Model } from './model.ts';
import { plan, type Plan } from './planner/index.ts';
import { settingsChanges, type Settings } from './settings.ts';

export interface Job {
  model: Model;
  /** The Machine settings snapshot, taken when the Job was last generated. */
  settings: Settings;
  /** Edited Sheet codes, by Sheet id. A Sheet not listed uses its derived code (`model.sheets[].code`). */
  sheetCodes: Record<string, string>;
  /** Made from `model`, `settings` and `sheetCodes`. */
  plan: Plan;
}

/** Plans a model with a snapshot of `settings`. */
export function generateJob(model: Model, settings: Settings, sheetCodes: Record<string, string> = {}): Job {
  const snapshot: Settings = {
    ...settings,
    edgeTrimBySheet: { ...settings.edgeTrimBySheet },
    manualBottomOpKinds: [...settings.manualBottomOpKinds],
  };
  return { model, settings: snapshot, sheetCodes, plan: plan(withSheetCodes(model, sheetCodes), snapshot) };
}

/** Re-plans the Job with the current global settings, which become its new snapshot. */
export function regenerate(job: Job, settings: Settings): Job {
  return generateJob(job.model, settings, job.sheetCodes);
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
 */
export function setSheetCode(job: Job, sheetId: string, input: string): { job: Job } | { error: string } {
  const sheet = job.model.sheets.find((s) => s.id === sheetId);
  if (!sheet) return { error: `There is no Sheet ${sheetId} in this Job.` };
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
  return { job: generateJob(job.model, job.settings, sheetCodes) };
}

function withSheetCodes(model: Model, codes: Record<string, string>): Model {
  return { ...model, sheets: model.sheets.map((s) => ({ ...s, code: codes[s.id] ?? s.code })) };
}
