// The Job store: where Job documents live between page loads. Two adapters share this interface
// and one contract test suite: IndexedDB (Dexie, in the shell) and in-memory (here, for tests and
// for when the browser refuses storage).
import { readJobDocument, type JobDocument } from './document.ts';

/** What the Job list shows. */
export type JobSummary = Pick<JobDocument, 'id' | 'shortId' | 'name' | 'archived' | 'createdAt' | 'updatedAt'>;

export interface JobStore {
  /** Every Job, archived ones included, most recently changed first. */
  list(): Promise<JobSummary[]>;
  /** The Job document, read through `readJobDocument` (older formats are migrated). Throws if unreadable. */
  get(id: string): Promise<JobDocument | undefined>;
  /** Adds or replaces the Job with `doc.id`. */
  put(doc: JobDocument): Promise<void>;
  delete(id: string): Promise<void>;
}

export function summarize(doc: JobDocument): JobSummary {
  const { id, shortId, name, archived, createdAt, updatedAt } = doc;
  return { id, shortId, name, archived, createdAt, updatedAt };
}

/** Newest `updatedAt` first, then by name. */
export function sortSummaries(jobs: JobSummary[]): JobSummary[] {
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

/**
 * What opening a `.job.json` should do, given the Jobs this browser has. Work is never lost and a short
 * id is never rewritten (printed labels carry it):
 * - `new`: no Job with that UUID, and its short id is free: add it.
 * - `same`: the saved copy is the same version (same `updatedAt`): open the saved copy as it is.
 * - `replace`: the saved copy is older: ask (`question`) before replacing it.
 * - `refuse`: the saved copy changed after the file, or another Job already uses the short id.
 */
export type OpenFileDecision =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'replace'; question: string }
  | { kind: 'refuse'; reason: string };

export function openFileDecision(file: JobDocument, jobs: readonly JobSummary[]): OpenFileDecision {
  const saved = jobs.find((j) => j.id === file.id);
  if (saved) {
    if (saved.updatedAt === file.updatedAt) return { kind: 'same' };
    if (saved.updatedAt > file.updatedAt) {
      return {
        kind: 'refuse',
        reason: `The copy of ${saved.name} saved in this browser was changed after this file (${when(saved.updatedAt)}, the file ${when(file.updatedAt)}), so the file was not opened. Download the saved copy and delete it first if you want the file instead.`,
      };
    }
    return {
      kind: 'replace',
      question: `Replace the copy of ${saved.name} saved in this browser (changed ${when(saved.updatedAt)}) with this file (changed ${when(file.updatedAt)})?`,
    };
  }
  const clash = jobs.find((j) => j.shortId.toUpperCase() === file.shortId.toUpperCase());
  if (clash) {
    return {
      kind: 'refuse',
      reason: `This Job's short id ${file.shortId} is already used by ${clash.name} in this browser. Its printed labels carry that id, so it can't be changed, and the file was not opened.`,
    };
  }
  return { kind: 'new' };
}

/** `2026-11-20 09:00 UTC` from an ISO time. */
function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Turns a stored record back into a document, or throws with the reason. */
export function storedDocument(value: unknown): JobDocument {
  const result = readJobDocument(value);
  if ('error' in result) throw new Error(result.error);
  return result.doc;
}

export function createMemoryJobStore(): JobStore {
  // Kept as JSON text, so callers never share objects with the store.
  const rows = new Map<string, string>();
  const read = (text: string) => storedDocument(JSON.parse(text));
  return {
    list: () => Promise.resolve(sortSummaries([...rows.values()].map((t) => summarize(read(t))))),
    get: (id) => {
      const text = rows.get(id);
      return Promise.resolve(text === undefined ? undefined : read(text));
    },
    put: (doc) => {
      rows.set(doc.id, JSON.stringify(doc));
      return Promise.resolve();
    },
    delete: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
  };
}
