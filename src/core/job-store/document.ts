// The Job document: one versioned record per Job, stored in IndexedDB and saved as `.job.json`.
// It keeps the raw export verbatim (the model is rebuilt from it by Import), the settings snapshot,
// Sheet codes, the Plan and the Saw/CNC overrides, progress, the id alias table, the re-import log, the
// stale flag and the document before the last re-import. Later slices add Offcuts and Spares as new fields; a breaking change bumps `jobFormat` and adds a
// migration from the previous one.
import { APP_NAME } from '../app.ts';
import { importExport, type ImportIssue } from '../import/index.ts';
import type { Job } from '../job.ts';
import type { Model } from '../model.ts';
import type { Plan } from '../planner/index.ts';
import { STEPS, type PartTicks, type Progress } from '../progress.ts';
import type { Category } from '../reimport.ts';
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
  /**
   * Step ticks by Export Part id (progress.ts). Roll-ups are computed from these, never stored. Missing in
   * files saved before ticking existed: read as no ticks.
   */
  progress: Progress;
  /**
   * Old Part id -> current Part id, for every Part a re-import moved to a new id (reimport.ts). Permanent, so
   * old stickers still scan: resolve with `resolvePartId`. `{}` in files saved before re-import existed.
   */
  aliases: Record<string, string>;
  /** One entry per applied re-import, oldest first. */
  reimportLog: ReimportLogEntry[];
  /**
   * Set by a re-import: the stored Plan predates the export ("Export updated, n Parts need nesting").
   * `needsNesting` = Added and Changed (cut) Part ids. Cleared by anything that re-plans (`withJob`).
   */
  stale: { needsNesting: string[] } | null;
  /**
   * The document as it was before the last re-import ("Revert last re-import"), with its own `previous`
   * dropped: one level only. Cleared by the next re-plan (`withJob`); replaced by the next re-import.
   */
  previous: JobDocument | null;
}

export interface ReimportLogEntry {
  /** When it was applied (ISO 8601). */
  at: string;
  /** The new export's `exportedAt`, when it has one. */
  exportedAt?: string;
  fileName: string;
  counts: Record<Category, number>;
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
    progress: {},
    aliases: {},
    reimportLog: [],
    stale: null,
    previous: null,
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
    ? {
        model,
        settings: doc.settings,
        sheetCodes: doc.sheetCodes,
        sawCnc: doc.sawCncOverrides,
        plan: doc.plan,
      }
    : null;
  return { model, issues, job };
}

/**
 * Stores a planned, re-planned or Sheet-code-edited Job in its document. A fresh Plan is no longer stale,
 * and ends "Revert last re-import".
 */
export function withJob(doc: JobDocument, job: Job, now: string): JobDocument {
  return {
    ...doc,
    settings: job.settings,
    sheetCodes: job.sheetCodes,
    sawCncOverrides: job.sawCnc,
    plan: job.plan,
    stale: null,
    previous: null,
    updatedAt: now,
  };
}

/** Stores the Job's ticks. */
export function withProgress(doc: JobDocument, progress: Progress, now: string): JobDocument {
  return { ...doc, progress, updatedAt: now };
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
    progress: {},
    aliases: strings('aliases', (v): v is string => typeof v === 'string'),
    reimportLog: [],
    stale: null,
    previous: null,
  };
  const log = raw['reimportLog'] ?? [];
  if (Array.isArray(log) && log.every(isLogEntry)) doc.reimportLog = log;
  else problems.push('reimportLog must be a list of re-imports');
  const stale = raw['stale'] ?? null;
  if (stale === null || (isRecord(stale) && isStringList(stale['needsNesting']))) {
    doc.stale = stale as JobDocument['stale'];
  } else problems.push('stale must list the Parts that need nesting, or be null');
  const previous = raw['previous'] ?? null;
  if (previous !== null) {
    const read = isRecord(previous) ? checkFields(previous) : { error: '' };
    if ('doc' in read) doc.previous = read.doc;
    else problems.push('previous must be a Job document or null');
  }
  const progress = raw['progress'] ?? {};
  if (isRecord(progress) && Object.values(progress).every(isPartTicks)) doc.progress = progress as Progress;
  else problems.push('progress must map Part ids to Step tick times');
  const plan = raw['plan'] ?? null;
  if (plan !== null && !(isRecord(plan) && Array.isArray(plan['sheets']))) problems.push('plan must be a Plan or null');
  else doc.plan = plan as Plan | null;

  if (problems.length > 0) return { error: `This file is not a usable Job file: ${problems.join('; ')}.` };
  return { doc };
}

function isLogEntry(v: unknown): v is ReimportLogEntry {
  return (
    isRecord(v) &&
    typeof v['at'] === 'string' &&
    typeof v['fileName'] === 'string' &&
    (v['exportedAt'] === undefined || typeof v['exportedAt'] === 'string') &&
    isRecord(v['counts']) &&
    Object.values(v['counts']).every((n) => typeof n === 'number')
  );
}

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isPartTicks(v: unknown): v is PartTicks {
  return (
    isRecord(v) &&
    Object.entries(v).every(([step, at]) => (STEPS as readonly string[]).includes(step) && typeof at === 'string')
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
