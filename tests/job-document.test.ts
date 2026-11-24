import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, setPartMode } from '../src/core/job.ts';
import {
  JOB_FORMAT,
  createJobDocument,
  fromJobFile,
  jobFileName,
  openJobDocument,
  renameJob,
  setArchived,
  shortIdFor,
  toJobFile,
  withJob,
  type JobDocument,
} from '../src/core/job-store/document.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

const rawExport = readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8');
const UUID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const NOW = '2026-11-24T10:15:00.000Z';

function syntheticDocument(): JobDocument {
  const { model } = importExport(JSON.parse(rawExport));
  if (!model) throw new Error('synthetic fixture must import');
  const settings = { ...DEFAULT_SETTINGS, clampMargin: 30000 };
  const doc = createJobDocument({ id: UUID, shortId: 'K7Q2', rawExport, fileName: 'synthetic.parts.json', model, settings, now: NOW });
  return withJob(doc, generateJob(model, settings, { [model.sheets[0]?.id ?? '']: 'WH18' }), NOW);
}

describe('The Job document', () => {
  it('is named after the export Project and the date by default', () => {
    const doc = syntheticDocument();
    expect(doc.jobFormat).toBe(1);
    expect(doc.name).toBe('Synthetic fixture 2026-11-24');
    expect(doc.id).toBe(UUID);
    expect(doc.shortId).toBe('K7Q2');
    expect(doc.archived).toBe(false);
    expect(doc.rawExport).toBe(rawExport);
    expect(doc.sawCncOverrides).toEqual({});
  });

  it('has no Plan until the export is planned', () => {
    const { model } = importExport(JSON.parse(rawExport));
    if (!model) throw new Error('synthetic fixture must import');
    const doc = createJobDocument({ id: UUID, shortId: 'K7Q2', rawExport, fileName: 'x.json', model, settings: DEFAULT_SETTINGS, now: NOW });
    expect(doc.plan).toBeNull();
    expect(doc.sheetCodes).toEqual({});
    expect(fromJobFile(toJobFile(doc))).toEqual({ doc });
  });

  it('can be renamed and archived, which moves its update time', () => {
    const doc = syntheticDocument();
    const later = '2026-11-25T08:00:00.000Z';
    const renamed = renameJob(doc, '  Kitchen carcasses  ', later);
    expect(renamed.name).toBe('Kitchen carcasses');
    expect(renamed.updatedAt).toBe(later);
    expect(renameJob(doc, '   ', later).name).toBe(doc.name);
    expect(setArchived(doc, true, later).archived).toBe(true);
    expect(doc.archived).toBe(false);
  });

  it('stores the Saw / CNC toggle in sawCncOverrides and opens with it', () => {
    const doc = syntheticDocument();
    const opened = openJobDocument(doc);
    if ('error' in opened || !opened.job) throw new Error('must open planned');
    const toggled = setPartMode(opened.job, 'c1/s0.rail[1]', 'cnc');
    if ('error' in toggled) throw new Error(toggled.error);

    const saved = withJob(doc, toggled.job, NOW);
    expect(saved.sawCncOverrides).toEqual({ 'c1/s0.rail[1]': 'cnc' });
    const read = fromJobFile(toJobFile(saved));
    if ('error' in read) throw new Error(read.error);
    const reopened = openJobDocument(read.doc);
    if ('error' in reopened) throw new Error(reopened.error);
    expect(reopened.job?.sawCnc).toEqual({ 'c1/s0.rail[1]': 'cnc' });
    expect(reopened.job?.plan.sheets[0]?.sawParts).toEqual(['c1/leftSide']);
  });

  it('downloads as <name>.job.json', () => {
    expect(jobFileName(syntheticDocument())).toBe('Synthetic fixture 2026-11-24.job.json');
  });
});

describe('.job.json', () => {
  it('round-trips a Job document unchanged', () => {
    const doc = syntheticDocument();
    const result = fromJobFile(toJobFile(doc));
    expect(result).toEqual({ doc });
  });

  it('keeps the raw export byte for byte', () => {
    const doc = { ...syntheticDocument(), rawExport: '{ "odd":\n\t"spacing" }\r\n' };
    const result = fromJobFile(toJobFile(doc));
    expect('doc' in result && result.doc.rawExport).toBe('{ "odd":\n\t"spacing" }\r\n');
  });

  it('keeps Plan fields this version does not know about', () => {
    const doc = syntheticDocument();
    const withExtra = { ...doc, plan: { ...doc.plan, offcuts: [{ id: 'W18-1-K1' }] } } as JobDocument;
    const result = fromJobFile(toJobFile(withExtra));
    expect(result).toEqual({ doc: withExtra });
  });

  it('refuses a file from a newer version of the app', () => {
    const file = JSON.stringify({ ...JSON.parse(toJobFile(syntheticDocument())), jobFormat: JOB_FORMAT + 1 });
    expect(fromJobFile(file)).toEqual({
      error:
        'This Job file was saved by a newer version of Cut Optimizer (jobFormat 2). This version opens jobFormat 1 or older; update the app to open it.',
    });
  });

  it('refuses files that are not Job files', () => {
    expect(fromJobFile('not json')).toEqual({ error: expect.stringContaining('not JSON') });
    expect(fromJobFile('{"format":"parts-export"}')).toEqual({ error: expect.stringContaining('not a Job file') });
    const broken = { ...JSON.parse(toJobFile(syntheticDocument())), id: 7 };
    expect(fromJobFile(JSON.stringify(broken))).toEqual({ error: expect.stringContaining('id') });
  });

  it('migrates an older jobFormat step by step', () => {
    const v1 = JSON.parse(toJobFile(syntheticDocument())) as Record<string, unknown>;
    // A pretend jobFormat 0 that called the name `title`.
    const { name, ...rest } = v1;
    const v0 = { ...rest, jobFormat: 0, title: name };
    const migrations = {
      0: (d: Record<string, unknown>) => {
        const { title, ...others } = d;
        return { ...others, name: title, jobFormat: 1 };
      },
    };
    expect(fromJobFile(JSON.stringify(v0), migrations)).toEqual({ doc: syntheticDocument() });
  });

  it('reads stored settings leniently, filling in missing fields from the defaults', () => {
    const file = JSON.parse(toJobFile(syntheticDocument())) as { settings: Record<string, unknown> };
    delete file.settings['fenceHeightNote'];
    const result = fromJobFile(JSON.stringify(file));
    expect('doc' in result && result.doc.settings.fenceHeightNote).toBe(DEFAULT_SETTINGS.fenceHeightNote);
  });
});

describe('short ids', () => {
  it('come from the UUID and grow until they are unique among the Jobs', () => {
    expect(shortIdFor(UUID, [])).toBe('3F2A');
    expect(shortIdFor(UUID, ['3F2A'])).toBe('3F2A9');
    expect(shortIdFor(UUID, ['3F2A', '3F2A9'])).toBe('3F2A9C');
  });
});

describe('opening a Job document', () => {
  it('rebuilds the model from the raw export and keeps the stored Plan, snapshot and Sheet codes', () => {
    const doc = syntheticDocument();
    const opened = openJobDocument(doc);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.job?.plan).toBe(doc.plan);
    expect(opened.job?.settings).toEqual(doc.settings);
    expect(opened.job?.sheetCodes).toEqual(doc.sheetCodes);
    expect(opened.model.projectName).toBe('Synthetic fixture');
    expect(opened.job?.model).toBe(opened.model);
    expect(opened.issues.length).toBeGreaterThan(0);
  });

  it('opens a Job with no Plan yet to its model only', () => {
    const opened = openJobDocument({ ...syntheticDocument(), plan: null });
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.job).toBeNull();
    expect(opened.model.parts.length).toBeGreaterThan(0);
  });

  it('reports an export that no longer imports', () => {
    expect(openJobDocument({ ...syntheticDocument(), rawExport: '{}' })).toEqual({
      error: expect.stringContaining('export'),
    });
  });
});
