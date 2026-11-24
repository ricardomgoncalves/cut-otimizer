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
