// The Job document: one versioned record per Job, stored in IndexedDB and saved as `.job.json`.
// It keeps the raw export verbatim (the model is rebuilt from it by Import), the settings snapshot,
// Sheet codes, the Plan and the Saw/CNC overrides. Later slices add progress, Offcuts, Spares, the
// alias table and the re-import log as new fields; a breaking change bumps `jobFormat` and adds a
// migration from the previous one.
import { APP_NAME } from '../app.ts';
import { importExport, type ImportIssue } from '../import/index.ts';
import type { Job } from '../job.ts';
import type { Model } from '../model.ts';
import type { Plan } from '../planner/index.ts';
import { parseSettings, type Settings } from '../settings.ts';

export const JOB_FORMAT = 1;

export interface JobDocument {
  jobFormat: typeof JOB_FORMAT;
  /** Local UUID: the Job's identity. */
  id: string;
  /** Short, human-typeable id, unique among this browser's Jobs (scan payloads use it). */
  shortId: string;
  name: string;
  archived: boolean;
  /** ISO 8601 times. */
  createdAt: string;
  updatedAt: string;
  /** The export's file name when it was loaded. */
  fileName: string;
  /** The Parts Export text, verbatim. */
  rawExport: string;
  /** The Machine settings snapshot the Plan was made with. */
  settings: Settings;
  /** Edited Sheet codes, by Sheet id. */
  sheetCodes: Record<string, string>;
  /**
   * The stored Plan (Breakdown and Layouts). Stored, never recomputed on load, and kept as
   * written: fields this version does not know about survive a round trip. `null` = not planned yet.
   */
  plan: Plan | null;
  /** Per-Part Saw/CNC choice made by hand, by Export Part id. */
  sawCncOverrides: Record<string, 'saw' | 'cnc'>;
}

/** A step from `jobFormat` n to n + 1, keyed by n. */
export type Migrations = Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>;

/** No format before 1 exists yet. Add `{ 1: (doc) => ... }` when jobFormat 2 arrives. */
export const MIGRATIONS: Migrations = {};

export interface NewJob {
  id: string;
  shortId: string;
  rawExport: string;
  fileName: string;
  /** The model Import built from `rawExport` (only its Project name is kept). */
  model: Model;
  /** The Machine settings at the time; replaced by the snapshot when the Job is planned. */
  settings: Settings;
  /** ISO 8601. The default name uses its date. */
  now: string;
}

/** A new, unplanned Job document, named `<Project name> <YYYY-MM-DD>`. */
export function createJobDocument({ id, shortId, rawExport, fileName, model, settings, now }: NewJob): JobDocument {
  return {
    jobFormat: JOB_FORMAT,
    id,
    shortId,
    name: `${model.projectName} ${now.slice(0, 10)}`.trim(),
    archived: false,
    createdAt: now,
    updatedAt: now,
    fileName,
    rawExport,
    settings,
    sheetCodes: {},
    plan: null,
    sawCncOverrides: {},
  };
}

export interface OpenedJob {
  /** Rebuilt by Import from the raw export. */
  model: Model;
  /** Recomputed from the raw export, not stored. */
  issues: ImportIssue[];
  /** The planned Job (the stored Plan as is, never recomputed), or null before the Job is planned. */
  job: Job | null;
}

/** The working form of a stored Job document. */
export function openJobDocument(doc: JobDocument): OpenedJob | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(doc.rawExport);
  } catch {
    return { error: `The export saved in ${doc.name} is not JSON.` };
  }
  const { model, issues } = importExport(json);
  if (!model) return { error: `The export saved in ${doc.name} is not a valid Parts Export v1.` };
  const job: Job | null = doc.plan
    ? { model, settings: doc.settings, sheetCodes: doc.sheetCodes, plan: doc.plan }
    : null;
  return { model, issues, job };
}

/** Stores a planned, re-planned or Sheet-code-edited Job in its document. */
export function withJob(doc: JobDocument, job: Job, now: string): JobDocument {
  return { ...doc, settings: job.settings, sheetCodes: job.sheetCodes, plan: job.plan, updatedAt: now };
}

/** Renames a Job. A blank name keeps the old one. */
export function renameJob(doc: JobDocument, name: string, now: string): JobDocument {
  const trimmed = name.trim();
  return trimmed === '' ? doc : { ...doc, name: trimmed, updatedAt: now };
}

export function setArchived(doc: JobDocument, archived: boolean, now: string): JobDocument {
  return { ...doc, archived, updatedAt: now };
}

/**
 * The shortest prefix (4 characters or more) of the UUID's hex digits, uppercased, that no other
 * Job uses.
 */
export function shortIdFor(uuid: string, taken: readonly string[]): string {
  const hex = uuid.replace(/[^0-9a-f]/gi, '').toUpperCase();
  for (let n = 4; n < hex.length; n++) {
    const candidate = hex.slice(0, n);
    if (!taken.includes(candidate)) return candidate;
  }
  return hex;
}

export function jobFileName(doc: JobDocument): string {
  return `${doc.name}.job.json`;
}

/** The `.job.json` text. */
export function toJobFile(doc: JobDocument): string {
  const { jobFormat, ...rest } = doc;
  return `${JSON.stringify({ jobFormat, ...rest }, null, 2)}\n`;
}

/** Reads a `.job.json`: version check, migration of older formats, then field checks. */
export function fromJobFile(text: string, migrations: Migrations = MIGRATIONS): { doc: JobDocument } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { error: `This file is not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return readJobDocument(json, migrations);
}

/** Reads a stored Job document (from a file or IndexedDB) the same way `fromJobFile` does. */
export function readJobDocument(
  value: unknown,
  migrations: Migrations = MIGRATIONS,
): { doc: JobDocument } | { error: string } {
  if (!isRecord(value) || typeof value['jobFormat'] !== 'number' || !Number.isInteger(value['jobFormat'])) {
    return { error: 'This file is not a Job file: it has no jobFormat.' };
  }
  let raw: Record<string, unknown> = value;
  let version = value['jobFormat'];
  if (version > JOB_FORMAT) {
    return {
      error: `This Job file was saved by a newer version of ${APP_NAME} (jobFormat ${String(version)}). This version opens jobFormat ${String(JOB_FORMAT)} or older; update the app to open it.`,
    };
  }
  while (version < JOB_FORMAT) {
    const step = migrations[version];
    if (!step) return { error: `This Job file is in jobFormat ${String(version)}, which this version can't read.` };
    raw = step(raw);
    version++;
  }
  return checkFields(raw);
}

function checkFields(raw: Record<string, unknown>): { doc: JobDocument } | { error: string } {
  const problems: string[] = [];
  const str = (key: string): string => {
    const v = raw[key];
    if (typeof v === 'string') return v;
    problems.push(`${key} must be text`);
    return '';
  };
  const strings = <T extends string>(key: string, ok: (v: unknown) => v is T): Record<string, T> => {
    const v = raw[key] ?? {};
    if (isRecord(v) && Object.values(v).every(ok)) return v as Record<string, T>;
    problems.push(`${key} must map ids to ${key === 'sawCncOverrides' ? '"saw" or "cnc"' : 'text'}`);
    return {};
  };

  const doc: JobDocument = {
    // Fields added by later versions within this jobFormat ride along untouched.
    ...raw,
    jobFormat: JOB_FORMAT,
    id: str('id'),
    shortId: str('shortId'),
    name: str('name'),
    archived: raw['archived'] === true,
    createdAt: str('createdAt'),
    updatedAt: str('updatedAt'),
    fileName: str('fileName'),
    rawExport: str('rawExport'),
    settings: parseSettings(raw['settings']),
    sheetCodes: strings('sheetCodes', (v): v is string => typeof v === 'string'),
    plan: null,
    sawCncOverrides: strings('sawCncOverrides', (v): v is 'saw' | 'cnc' => v === 'saw' || v === 'cnc'),
  };
  const plan = raw['plan'] ?? null;
  if (plan !== null && !(isRecord(plan) && Array.isArray(plan['sheets']))) problems.push('plan must be a Plan or null');
  else doc.plan = plan as Plan | null;

  if (problems.length > 0) return { error: `This file is not a usable Job file: ${problems.join('; ')}.` };
  return { doc };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
