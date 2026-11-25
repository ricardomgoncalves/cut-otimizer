import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDxfFiles } from '../src/core/dxf/index.ts';
import { importExport } from '../src/core/import/index.ts';
import {
  addBoards,
  generateJob,
  lockedBoards,
  needsNesting,
  nestingQueue,
  partMode,
  pendingChoices,
  regenerate,
  remake,
  setOffcutDiscarded,
  setPartMode,
  setSheetCode,
  sheetCode,
  type Job,
} from '../src/core/job.ts';
import type { Model } from '../src/core/model.ts';
import type { Board } from '../src/core/planner/index.ts';
import { apply, type Progress } from '../src/core/progress.ts';
import { DEFAULT_SETTINGS, settingsChanges, type Settings } from '../src/core/settings.ts';

/** Boards without their Locked Blanks' frozen Side A pages (`Blank.sideA`), which a regenerate adds. */
function unfrozen(boards: readonly Board[] | undefined): Board[] | undefined {
  return boards?.map((b) => ({
    ...b,
    blanks: b.blanks.map((x) => {
      const blank = { ...x };
      delete blank.sideA;
      return blank;
    }),
  }));
}

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
    expect(settingsChanges(job.settings, settings)).toEqual([]);
  });

  it("doesn't change its DXFs when the global settings change, until it is regenerated", () => {
    const global: Settings = { ...DEFAULT_SETTINGS };
    const job = generateJob(syntheticModel(), global);
    const before = toDxfFiles(job.plan, 'J1');

    // The maker edits the global settings afterwards.
    const edited: Settings = { ...global, clampMargin: 100000 };
    expect(settingsChanges(job.settings, edited)).toEqual(['clampMargin']);
    expect(toDxfFiles(job.plan, 'J1')).toEqual(before);

    const regenerated = regenerate(job, edited);
    expect(settingsChanges(regenerated.settings, edited)).toEqual([]);
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

  it('change nothing in the Plan until Regenerate, which shows them in Blank ids and DXF file names', () => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    const result = setSheetCode(job, W18(model), ' wh18 ');
    if ('error' in result) throw new Error(result.error);

    expect(sheetCode(result.job, W18(model))).toBe('WH18');
    expect(result.job.plan).toBe(job.plan);
    expect(pendingChoices(result.job, {})).toEqual({ partModes: [], sheetCodes: [W18(model)] });

    const regenerated = regenerate(result.job, DEFAULT_SETTINGS);
    expect(blankIds(regenerated)).toEqual(['WH18-1-A', 'O16-1-A']);
    expect([...toDxfFiles(regenerated.plan, 'J1').keys()]).toEqual([
      'WH18-1-A.side-a.dxf',
      'O16-1-A.side-a.dxf',
      'J1-B1.side-b.dxf',
    ]);
    expect(pendingChoices(regenerated, {})).toEqual({ partModes: [], sheetCodes: [] });
  });

  it('go back to the derived code when cleared', () => {
    const model = syntheticModel();
    const edited = setSheetCode(generateJob(model, DEFAULT_SETTINGS), W18(model), 'X1');
    if ('error' in edited) throw new Error(edited.error);
    const cleared = setSheetCode(edited.job, W18(model), '');
    if ('error' in cleared) throw new Error(cleared.error);

    expect(cleared.job.sheetCodes).toEqual({});
    expect(pendingChoices(cleared.job, {}).sheetCodes).toEqual([]);
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

  it('records the choice; Regenerate sends the narrow op-less Part to the CNC, and back to the saw', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(job.plan.sheets[0]?.sawParts).toContain(rail);
    expect(partMode(job, rail)).toBe('saw');

    const cnc = setPartMode(job, rail, 'cnc');
    if ('error' in cnc) throw new Error(cnc.error);
    expect(cnc.job.sawCnc).toEqual({ [rail]: 'cnc' });
    expect(partMode(cnc.job, rail)).toBe('cnc');
    expect(cnc.job.plan).toBe(job.plan);
    expect(pendingChoices(cnc.job, {})).toEqual({ partModes: [rail], sheetCodes: [] });

    const nested = regenerate(cnc.job, DEFAULT_SETTINGS);
    expect(nested.plan.sheets[0]?.sawParts).not.toContain(rail);
    expect(railBlank(nested)).toMatch(/^W18-1-/);
    expect(pendingChoices(nested, {}).partModes).toEqual([]);

    // Back to its automatic mode: no choice stored.
    const saw = setPartMode(nested, rail, 'saw');
    if ('error' in saw) throw new Error(saw.error);
    expect(saw.job.sawCnc).toEqual({});
    expect(regenerate(saw.job, DEFAULT_SETTINGS).plan.sheets[0]?.sawParts).toContain(rail);
  });

  it('keeps the choice on regenerate', () => {
    const job = generateJob(syntheticModel(), { ...DEFAULT_SETTINGS, clampMargin: 30000 });
    const cnc = setPartMode(job, rail, 'cnc');
    if ('error' in cnc) throw new Error(cnc.error);
    expect(cnc.job.settings.clampMargin).toBe(30000);
    expect(regenerate(cnc.job, DEFAULT_SETTINGS).sawCnc).toEqual({ [rail]: 'cnc' });
  });

  it('is not available for a Part bigger than the bed', () => {
    const job = generateJob(syntheticModel(), { ...DEFAULT_SETTINGS, allowTiling: false });
    expect(setPartMode(job, 'c1/leftSide', 'cnc')).toEqual({
      error: 'This Part is bigger than the usable bed, so it is always cut on the saw.',
    });
  });

  it('with tiling on, sends a Part longer than the bed to the CNC, on a Tiled Blank', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(partMode(job, 'c1/leftSide')).toBe('saw');
    const cnc = setPartMode(job, 'c1/leftSide', 'cnc');
    if ('error' in cnc) throw new Error(cnc.error);
    expect(cnc.job.sawCnc).toEqual({ 'c1/leftSide': 'cnc' });
    const tiled = regenerate(cnc.job, DEFAULT_SETTINGS).plan.sheets[0]?.boards[0]?.blanks.find((b) =>
      b.parts.some((p) => p.partId === 'c1/leftSide'),
    );
    expect(tiled?.tiled).toBe(true);
  });

  it('with tiling on, says tiling only goes along X for a Part too wide for the bed', () => {
    const model = syntheticModel();
    model.parts = model.parts.map((p) => (p.id === 'c1/leftSide' ? { ...p, cutWidth: 1400000 } : p));
    expect(setPartMode(generateJob(model, DEFAULT_SETTINGS), 'c1/leftSide', 'cnc')).toEqual({
      error:
        'This Part is bigger than the usable bed, so it is always cut on the saw. Tiling only goes along X: it must fit the bed’s width.',
    });
  });
});

describe('Locked Boards and Blanks on regenerate', () => {
  const SHELF = 'c1/s0.shelf[0]';
  const T1 = '2026-11-24T10:00:00.000Z';
  const shelfCut: Progress = { [SHELF]: { cut: T1 } };
  const edited: Settings = { ...DEFAULT_SETTINGS, clampMargin: 60000 };

  it('keeps a Locked Blank and its DXF byte for byte, and re-plans the rest with the new snapshot', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    const before = toDxfFiles(job.plan, 'J1');
    const regenerated = regenerate(job, edited, shelfCut);

    expect(regenerated.settings).toEqual(edited);
    expect(unfrozen(regenerated.plan.sheets[0]?.boards)).toEqual(job.plan.sheets[0]?.boards);
    const after = toDxfFiles(regenerated.plan, 'J1');
    expect(after.get('W18-1-A.side-a.dxf')).toEqual(before.get('W18-1-A.side-a.dxf'));
    expect(regenerated.plan.sheets[0]?.boards[0]?.blanks[0]?.sideA?.sheetName).toBeDefined();
    // The O16 Blank holds nothing cut, so it is nested again with the 60 mm margin.
    expect(after.get('O16-1-A.side-a.dxf')).not.toEqual(before.get('O16-1-A.side-a.dxf'));
    expect(after.get('O16-1-A.side-a.dxf')).toContain('\n60\n');
  });

  it('unlocks a Blank once its last Cut is unticked: the next regenerate re-plans it', () => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    const unticked = apply(job, shelfCut, { kind: 'untick', partId: SHELF, step: 'cut' });

    expect(regenerate(job, edited, unticked).plan).toEqual(generateJob(model, edited).plan);
  });

  it('refuses the Saw / CNC toggle on a Part of a Locked Board, and keeps Locked Boards when toggling others', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(setPartMode(job, 'c1/s0.rail[1]', 'cnc', shelfCut)).toEqual({
      error: 'This Part is on Locked Board W18-1, so it stays where it is.',
    });

    const toe = setPartMode(job, 'w1.left.lower.c1/toeKick/0', 'saw', shelfCut);
    if ('error' in toe) throw new Error(toe.error);
    const regenerated = regenerate(toe.job, DEFAULT_SETTINGS, shelfCut);
    expect(unfrozen(regenerated.plan.sheets[0]?.boards)).toEqual(job.plan.sheets[0]?.boards);
    expect(regenerated.plan.sheets[1]?.sawParts).toEqual(['w1.left.lower.c1/toeKick/0']);
  });

  it('lets a Part on an uncut Blank of a Locked Board switch, and refuses one on a Locked Blank', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    const railCut: Progress = { 'c1/s0.rail[1]': { cut: T1 } };
    const shelf = setPartMode(job, SHELF, 'saw', railCut);
    if ('error' in shelf) throw new Error(shelf.error);
    expect(shelf.job.sawCnc).toEqual({ [SHELF]: 'saw' });
    expect(setPartMode(job, 'c1/s0.door.leaf[0]', 'saw', shelfCut)).toEqual({
      error: 'This Part is on Locked Blank W18-1-A, so it stays where it is.',
    });
  });

  it('refuses a new Sheet code while the Sheet has Locked Boards, since Locked Blanks keep their ids', () => {
    const model = syntheticModel();
    const job = generateJob(model, DEFAULT_SETTINGS);
    expect(setSheetCode(job, W18(model), 'X1', shelfCut)).toEqual({
      error: 'W18 has Locked Boards, so its code can no longer change.',
    });
    expect('job' in setSheetCode(job, O16(model), 'X1', shelfCut)).toBe(true);
  });
});

describe('Remake and kept Offcuts', () => {
  const SHELF = 'c1/s0.shelf[0]';
  const DOOR = 'c1/s0.door.leaf[0]';
  const T1 = '2026-11-24T10:00:00.000Z';
  const bothCut: Progress = { [SHELF]: { cut: T1, banded: T1 }, [DOOR]: { cut: T1 } };
  const placements = (job: Job, partId: string) =>
    job.plan.sheets.flatMap((s) =>
      s.boards.flatMap((b) =>
        b.blanks.flatMap((x) => x.parts.filter((p) => p.partId === partId).map((p) => ({ blank: x, p }))),
      ),
    );

  it("clears the Part's ticks, greys it on its old Blank, which stays Locked, and nests it again at regenerate", () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    const result = remake(job, bothCut, SHELF);
    if ('error' in result) throw new Error(result.error);

    expect(result.progress).toEqual({ [DOOR]: { cut: T1 } });
    expect(placements(result.job, SHELF).map(({ blank, p }) => [blank.id, p.remade])).toEqual([['W18-1-A', true]]);
    expect(lockedBoards(result.job, result.progress).map((b) => b.id)).toEqual(['W18-1']);

    // Without the door's tick the old Blank is still Locked by the Remake.
    const alone = remake(job, { [SHELF]: { cut: T1 } }, SHELF);
    if ('error' in alone) throw new Error(alone.error);
    expect(lockedBoards(alone.job, alone.progress).map((b) => b.id)).toEqual(['W18-1']);

    expect(needsNesting(alone.job)).toEqual([SHELF]);
    const next = regenerate(alone.job, DEFAULT_SETTINGS, alone.progress);
    expect(needsNesting(next)).toEqual([]);
    expect(placements(next, SHELF).map(({ blank, p }) => [blank.id, blank.from, p.remade])).toEqual([
      ['W18-1-A', undefined, true],
      // The first kept Offcut the shelf fits with its clamp margins (K1 is too small).
      ['W18-1-B', 'W18-1-K2', undefined],
    ]);
  });

  it('only remakes a Part already cut', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    expect(remake(job, {}, SHELF)).toEqual({ error: 'Only a Part already cut can be remade.' });
    expect(remake(job, {}, 'nope')).toEqual({ error: 'There is no Part nope in this Job.' });
  });

  it('discards a kept Offcut and undoes that', () => {
    const job = generateJob(syntheticModel(), DEFAULT_SETTINGS);
    const discarded = setOffcutDiscarded(job, 'W18-1-K1', true);
    if ('error' in discarded) throw new Error(discarded.error);
    const offcut = discarded.job.plan.sheets[0]?.boards[0]?.offcuts.find((o) => o.id === 'W18-1-K1');
    expect(offcut?.discarded).toBe(true);

    const back = setOffcutDiscarded(discarded.job, 'W18-1-K1', false);
    if ('error' in back) throw new Error(back.error);
    expect(back.job.plan).toEqual(job.plan);
    expect(setOffcutDiscarded(job, 'W18-9-K1', true)).toEqual({
      error: 'There is no kept Offcut W18-9-K1 in this Job.',
    });
  });

  it('lists the Parts that fit nowhere and adds a Board only when asked', () => {
    const model = syntheticModel();
    let job = generateJob(model, DEFAULT_SETTINGS);
    for (const o of job.plan.sheets[0]?.boards[0]?.offcuts ?? []) {
      if (!o.id) continue;
      const r = setOffcutDiscarded(job, o.id, true);
      if ('error' in r) throw new Error(r.error);
      job = r.job;
    }
    const marked = remake(job, { [SHELF]: { cut: T1 } }, SHELF);
    if ('error' in marked) throw new Error(marked.error);

    const asked = regenerate(marked.job, DEFAULT_SETTINGS, marked.progress);
    expect(asked.plan.sheets[0]?.overflow).toEqual([SHELF]);
    expect(needsNesting(asked)).toEqual([SHELF]);
    expect(asked.plan.sheets[0]?.boards.map((b) => b.number)).toEqual([1]);
    // The shell asks: "Add Board 2 of 2 to W18".
    expect(nestingQueue(asked)).toEqual({
      waiting: [],
      requests: [{ sheetId: W18(model), code: 'W18', partIds: [SHELF], first: 2, last: 2 }],
    });
    // Before the regenerate, the Remake only waits for it.
    expect(nestingQueue(marked.job)).toEqual({ waiting: [SHELF], requests: [] });

    const added = addBoards(asked, [W18(model)], marked.progress);
    expect(added.plan.sheets[0]?.overflow).toEqual([]);
    expect(placements(added, SHELF).map(({ blank }) => blank.id)).toEqual(['W18-1-A', 'W18-2-A']);
  });
});
