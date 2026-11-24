import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import { generateJob } from '../src/core/job.ts';
import {
  createJobDocument,
  fromJobFile,
  renameJob,
  setArchived,
  toJobFile,
  withJob,
  type JobDocument,
} from '../src/core/job-store/document.ts';
import { createMemoryJobStore, type JobStore } from '../src/core/job-store/store.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';
import { createDexieJobStore } from '../src/shell/job-store-dexie.ts';

const rawExport = readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8');

function documentFor(id: string, shortId: string, now: string): JobDocument {
  const { model } = importExport(JSON.parse(rawExport));
  if (!model) throw new Error('synthetic fixture must import');
  const job = generateJob(model, DEFAULT_SETTINGS);
  const doc = createJobDocument({ id, shortId, rawExport, fileName: 'synthetic.parts.json', model, settings: DEFAULT_SETTINGS, now });
  return withJob(doc, job, now);
}

const A = () => documentFor('aaaaaaaa-0000-4000-8000-000000000001', 'AAAA', '2026-11-20T09:00:00.000Z');
const B = () => documentFor('bbbbbbbb-0000-4000-8000-000000000002', 'BBBB', '2026-11-21T09:00:00.000Z');

let dbCount = 0;
const adapters: [string, () => JobStore][] = [
  ['in-memory', () => createMemoryJobStore()],
  ['IndexedDB', () => createDexieJobStore(`jobs-test-${String(++dbCount)}`)],
];

describe.each(adapters)('JobStore (%s)', (_name, makeStore) => {
  it('starts empty', async () => {
    const store = makeStore();
    expect(await store.list()).toEqual([]);
    expect(await store.get('nope')).toBeUndefined();
  });

  it('gives back a stored Job document unchanged', async () => {
    const store = makeStore();
    const doc = A();
    await store.put(doc);
    expect(await store.get(doc.id)).toEqual(doc);
  });

  it('round-trips a document read from .job.json', async () => {
    const store = makeStore();
    const result = fromJobFile(toJobFile(A()));
    if (!('doc' in result)) throw new Error(result.error);
    await store.put(result.doc);
    const back = await store.get(result.doc.id);
    expect(back).toEqual(A());
    if (!back) throw new Error('missing');
    expect(fromJobFile(toJobFile(back))).toEqual({ doc: A() });
  });

  it('lists Jobs most recently changed first, archived ones included', async () => {
    const store = makeStore();
    await store.put(A());
    await store.put(B());
    await store.put(setArchived(A(), true, '2026-11-22T09:00:00.000Z'));

    expect(await store.list()).toEqual([
      {
        id: A().id,
        shortId: 'AAAA',
        name: 'Synthetic fixture 2026-11-20',
        archived: true,
        createdAt: '2026-11-20T09:00:00.000Z',
        updatedAt: '2026-11-22T09:00:00.000Z',
      },
      {
        id: B().id,
        shortId: 'BBBB',
        name: 'Synthetic fixture 2026-11-21',
        archived: false,
        createdAt: '2026-11-21T09:00:00.000Z',
        updatedAt: '2026-11-21T09:00:00.000Z',
      },
    ]);
  });

  it('replaces a Job when it is saved again', async () => {
    const store = makeStore();
    await store.put(A());
    await store.put(renameJob(A(), 'Kitchen', '2026-11-23T09:00:00.000Z'));
    expect((await store.get(A().id))?.name).toBe('Kitchen');
    expect(await store.list()).toHaveLength(1);
  });

  it('deletes a Job', async () => {
    const store = makeStore();
    await store.put(A());
    await store.put(B());
    await store.delete(A().id);
    expect(await store.get(A().id)).toBeUndefined();
    expect((await store.list()).map((j) => j.id)).toEqual([B().id]);
  });

  it("is not changed by edits to a document it handed out", async () => {
    const store = makeStore();
    await store.put(A());
    const got = await store.get(A().id);
    if (!got) throw new Error('missing');
    got.name = 'mutated';
    got.sheetCodes['x'] = 'Y';
    expect(await store.get(A().id)).toEqual(A());
  });
});
