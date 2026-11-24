import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDxfFiles } from '../src/core/dxf/index.ts';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, regenerate, setPartMode, setSheetCode, sheetCode, snapshotChanges } from '../src/core/job.ts';
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
    const before = toDxfFiles(job.plan, 'J1');

    // The maker edits the global settings afterwards.
    const edited: Settings = { ...global, clampMargin: 100000 };
    expect(snapshotChanges(job, edited)).toEqual(['clampMargin']);
    expect(toDxfFiles(job.plan, 'J1')).toEqual(before);

    const regenerated = regenerate(job, edited);
    expect(snapshotChanges(regenerated, edited)).toEqual([]);
    expect(toDxfFiles(regenerated.plan, 'J1').get('W18-1-A.side-a.dxf')).not.toEqual(before.get('W18-1-A.side-a.dxf'));
    expect(toDxfFiles(regenerated.plan, 'J1').get('W18-1-A.side-a.dxf')).toContain('\n100\n');
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
    expect([...toDxfFiles(result.job.plan, 'J1').keys()]).toEqual([
      'WH18-1-A.side-a.dxf',
      'O16-1-A.side-a.dxf',
      'J1-B1.side-b.dxf',
    ]);
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

describe('Saw / CNC toggle', () => {
  const rail = 'c1/s0.rail[1]';
  const railBlank = (job: ReturnType<typeof generateJob>) =>
    job.plan.sheets
      .flatMap((s) => s.boards.flatMap((b) => b.blanks))
      .find((b) => b.parts.some((p) => p.partId === rail))?.id;

  it('sends the narrow op-less Part back to the CNC, where it is nested, and back to the saw', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(job.plan.sheets[0]?.sawParts).toContain(rail);

    const cnc = setPartMode(job, rail, 'cnc');
    if ('error' in cnc) throw new Error(cnc.error);
    expect(cnc.job.sawCnc).toEqual({ [rail]: 'cnc' });
    expect(cnc.job.plan.sheets[0]?.sawParts).not.toContain(rail);
    expect(railBlank(cnc.job)).toMatch(/^W18-1-/);

    // Back to its automatic mode: no choice stored.
    const saw = setPartMode(cnc.job, rail, 'saw');
    if ('error' in saw) throw new Error(saw.error);
    expect(saw.job.sawCnc).toEqual({});
    expect(saw.job.plan.sheets[0]?.sawParts).toContain(rail);
  });

  it('re-plans with the snapshot and keeps the choice on regenerate', () => {
    const job = generateJob(syntheticModel(), { ...DEFAULT_SETTINGS, clampMargin: 30000 });
    const cnc = setPartMode(job, rail, 'cnc');
    if ('error' in cnc) throw new Error(cnc.error);
    expect(cnc.job.settings.clampMargin).toBe(30000);
    expect(regenerate(cnc.job, DEFAULT_SETTINGS).sawCnc).toEqual({ [rail]: 'cnc' });
  });

  it('is not available for a Part bigger than the bed', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(setPartMode(job, 'c1/leftSide', 'cnc')).toEqual({
      error: 'This Part is bigger than the usable bed, so it is always cut on the saw.',
    });
  });
});
