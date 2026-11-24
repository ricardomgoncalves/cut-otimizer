// The IndexedDB adapter of the Job store (Dexie, as cabinet-planner uses). One row per Job, keyed
// by its UUID; each row is the Job document as is, read back through `readJobDocument`.
import { Dexie, type Table } from 'dexie';
import { sortSummaries, storedDocument, summarize, type JobStore } from '../core/job-store/store.ts';

export const DB_NAME = 'cut-optimizer';

class JobDb extends Dexie {
  jobs!: Table<unknown, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ jobs: '' });
  }
}

export function createDexieJobStore(name: string = DB_NAME): JobStore {
  const db = new JobDb(name);
  return {
    async list() {
      const rows = await db.jobs.toArray();
      return sortSummaries(rows.map((row) => summarize(storedDocument(row))));
    },
    async get(id) {
      const row = await db.jobs.get(id);
      return row === undefined ? undefined : storedDocument(row);
    },
    async put(doc) {
      await db.jobs.put(doc, doc.id);
    },
    async delete(id) {
      await db.jobs.delete(id);
    },
  };
}
