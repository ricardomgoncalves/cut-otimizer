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
  withProgress,
  type JobDocument,
} from '../src/core/job-store/document.ts';
import { createMemoryJobStore, openFileDecision, summarize, type JobStore } from '../src/core/job-store/store.ts';
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

  it('keeps the ticks of a Job', async () => {
    const store = makeStore();
    const ticked = withProgress(A(), { 'c1/s0.rail[1]': { cut: '2026-11-22T09:00:00.000Z' } }, '2026-11-22T09:00:00.000Z');
    await store.put(ticked);
    expect((await store.get(ticked.id))?.progress).toEqual({ 'c1/s0.rail[1]': { cut: '2026-11-22T09:00:00.000Z' } });
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

describe('opening a .job.json into the Job list', () => {
  const later = '2026-11-22T09:00:00.000Z';

  it('adds a Job this browser does not have', () => {
    expect(openFileDecision(A(), [summarize(B())])).toEqual({ kind: 'new' });
  });

  it('opens the saved copy as it is when the file is the same version of the Job', () => {
    expect(openFileDecision(A(), [summarize(A())])).toEqual({ kind: 'same' });
  });

  it('asks before replacing an older saved copy', () => {
    const file = renameJob(A(), 'Kitchen', later);
    expect(openFileDecision(file, [summarize(A())])).toEqual({
      kind: 'replace',
      question: `Replace the copy of ${A().name} saved in this browser (changed 2026-11-20 09:00 UTC) with this file (changed 2026-11-22 09:00 UTC)?`,
    });
  });

  it('refuses to overwrite a saved copy changed after the file', () => {
    const saved = renameJob(A(), 'Kitchen', later);
    expect(openFileDecision(A(), [summarize(saved)])).toEqual({
      kind: 'refuse',
      reason:
        'The copy of Kitchen saved in this browser was changed after this file (2026-11-22 09:00 UTC, the file 2026-11-20 09:00 UTC), so the file was not opened. Download the saved copy and delete it first if you want the file instead.',
    });
  });

  it('refuses another Job with a short id already in use, since its labels would scan into the wrong Job', () => {
    const clash = { ...B(), shortId: 'AAAA' };
    expect(openFileDecision(clash, [summarize(A())])).toEqual({
      kind: 'refuse',
      reason: `This Job's short id AAAA is already used by ${A().name} in this browser. Its printed labels carry that id, so it can't be changed, and the file was not opened.`,
    });
  });
});
