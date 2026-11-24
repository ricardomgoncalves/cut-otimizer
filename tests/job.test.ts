import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDxfFiles } from '../src/core/dxf/index.ts';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, regenerate, setSheetCode, sheetCode, snapshotChanges } from '../src/core/job.ts';
import type { Model } from '../src/core/model.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';

function syntheticModel(): Model {
  const json: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8'),
  );
  const { model } = importExport(json);
  if (!model) throw new Error('synthetic fixture must import');
  return model;
}

const W18 = (model: Model) => model.sheets[0]?.id ?? '';
const O16 = (model: Model) => model.sheets[1]?.id ?? '';
const blankIds = (job: ReturnType<typeof generateJob>) =>
  job.plan.sheets.flatMap((s) => s.boards.flatMap((b) => b.blanks.map((x) => x.id)));

describe('Job settings snapshot', () => {
  it('keeps the settings it was generated with', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, clampMargin: 30000 };
    const job = generateJob(syntheticModel(), settings);

    expect(job.settings).toEqual(settings);
    expect(job.plan.settings).toEqual(settings);
    expect(snapshotChanges(job, settings)).toEqual([]);
  });

  it("doesn't change its DXFs when the global settings change, until it is regenerated", () => {
    const global: Settings = { ...DEFAULT_SETTINGS };
    const job = generateJob(syntheticModel(), global);
    const before = toDxfFiles(job.plan);

    // The maker edits the global settings afterwards.
    const edited: Settings = { ...global, clampMargin: 100000 };
    expect(snapshotChanges(job, edited)).toEqual(['clampMargin']);
    expect(toDxfFiles(job.plan)).toEqual(before);

    const regenerated = regenerate(job, edited);
    expect(snapshotChanges(regenerated, edited)).toEqual([]);
    expect(toDxfFiles(regenerated.plan).get('W18-1-A.side-a.dxf')).not.toEqual(before.get('W18-1-A.side-a.dxf'));
    expect(toDxfFiles(regenerated.plan).get('W18-1-A.side-a.dxf')).toContain('\n100\n');
  });
});

describe('Sheet codes', () => {
  it('default to the derived code', () => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    expect(sheetCode(job, W18(model))).toBe('W18');
    expect(job.sheetCodes).toEqual({});
  });

  it('show an edited code in Blank ids and DXF file names', () => {
    const model = syntheticModel();
    const result = setSheetCode(generateJob(model, DEFAULT_SETTINGS), W18(model), ' wh18 ');
    if ('error' in result) throw new Error(result.error);

    expect(sheetCode(result.job, W18(model))).toBe('WH18');
    expect(blankIds(result.job)).toEqual(['WH18-1-A', 'O16-1-A']);
    expect([...toDxfFiles(result.job.plan).keys()]).toEqual(['WH18-1-A.side-a.dxf', 'O16-1-A.side-a.dxf']);
  });

  it('re-plan with the snapshot, not with newer global settings', () => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    const result = setSheetCode(job, O16(model), 'OAK16');
    if ('error' in result) throw new Error(result.error);

    expect(result.job.settings).toEqual(DEFAULT_SETTINGS);
    expect(blankIds(result.job)).toEqual(['W18-1-A', 'OAK16-1-A']);
  });

  it('go back to the derived code when cleared', () => {
    const model = syntheticModel();
    const edited = setSheetCode(generateJob(model, DEFAULT_SETTINGS), W18(model), 'X1');
    if ('error' in edited) throw new Error(edited.error);
    const cleared = setSheetCode(edited.job, W18(model), '');
    if ('error' in cleared) throw new Error(cleared.error);

    expect(cleared.job.sheetCodes).toEqual({});
    expect(blankIds(cleared.job)).toEqual(['W18-1-A', 'O16-1-A']);
  });

  it('carry over when the Job is regenerated', () => {
    const model = syntheticModel();
    const edited = setSheetCode(generateJob(model, DEFAULT_SETTINGS), W18(model), 'X1');
    if ('error' in edited) throw new Error(edited.error);

    expect(blankIds(regenerate(edited.job, { ...DEFAULT_SETTINGS, clampMargin: 30000 }))).toEqual([
      'X1-1-A',
      'O16-1-A',
    ]);
  });

  it.each([
    ['O16', 'O16 is already the code of Oak MDF 16.'],
    ['W-18', 'A Sheet code may only hold letters and digits.'],
    ['W18 B', 'A Sheet code may only hold letters and digits.'],
    ['ABCDEFGHIJKLM', 'A Sheet code may be at most 12 characters.'],
  ])('reject %j', (code, error) => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    expect(setSheetCode(job, W18(model), code)).toEqual({ error });
  });
});
