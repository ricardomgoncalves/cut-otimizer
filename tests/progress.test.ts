import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, remake, type Job } from '../src/core/job.ts';
import { apply, isDone, reprintSelection, rollup, steps, wouldUnlock, type Progress } from '../src/core/progress.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

// The synthetic fixture, planned with default settings:
//   W18 Board 1: Blank W18-1-A = door (#1), shelf (#2); Saw Parts leftSide, rail.
//   O16 Board 1: Blank O16-1-A = toe kick.
//   Side B file B1 = door. Manual ops: shelf (edge drill). Banded: leftSide, shelf, door.
const LEFT = 'c1/leftSide';
const SHELF = 'c1/s0.shelf[0]';
const RAIL = 'c1/s0.rail[1]';
const DOOR = 'c1/s0.door.leaf[0]';
const TOE = 'w1.left.lower.c1/toeKick/0';
const T1 = '2026-11-24T10:00:00.000Z';
const T2 = '2026-11-24T11:00:00.000Z';

function syntheticJob(): Job {
  const { model } = importExport(JSON.parse(readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8')));
  if (!model) throw new Error('synthetic fixture must import');
  return generateJob(model, DEFAULT_SETTINGS);
}

const job = syntheticJob();
const tickAll = (progress: Progress, partId: string): Progress =>
  steps(job, partId).reduce((p, step) => apply(job, p, { kind: 'tick', partId, step, at: T1 }), progress);

describe('Applicable Steps', () => {
  it('always include Cut, then Side B for Flip Parts, Banded for banded Parts and Manual ops', () => {
    expect(steps(job, RAIL)).toEqual(['cut']);
    expect(steps(job, TOE)).toEqual(['cut']);
    expect(steps(job, LEFT)).toEqual(['cut', 'banded']);
    expect(steps(job, SHELF)).toEqual(['cut', 'banded', 'manualOps']);
    expect(steps(job, DOOR)).toEqual(['cut', 'sideB', 'banded']);
  });
});

describe('Ticking a Step', () => {
  it('stores the time it was ticked, by Export Part id', () => {
    const progress = apply(job, {}, { kind: 'tick', partId: SHELF, step: 'cut', at: T1 });
    expect(progress).toEqual({ [SHELF]: { cut: T1 } });
  });

  it('keeps the first time when a Step is ticked again', () => {
    const once = apply(job, {}, { kind: 'tick', partId: SHELF, step: 'cut', at: T1 });
    expect(apply(job, once, { kind: 'tick', partId: SHELF, step: 'cut', at: T2 })).toEqual({ [SHELF]: { cut: T1 } });
  });

  it('ignores a Step that does not apply to the Part, and unknown Parts', () => {
    expect(apply(job, {}, { kind: 'tick', partId: RAIL, step: 'banded', at: T1 })).toEqual({});
    expect(apply(job, {}, { kind: 'tick', partId: 'nope', step: 'cut', at: T1 })).toEqual({});
  });

  it('makes a Part Done once all of its Steps are ticked', () => {
    let progress = apply(job, {}, { kind: 'tick', partId: DOOR, step: 'cut', at: T1 });
    progress = apply(job, progress, { kind: 'tick', partId: DOOR, step: 'banded', at: T1 });
    expect(isDone(job, progress, DOOR)).toBe(false);
    progress = apply(job, progress, { kind: 'tick', partId: DOOR, step: 'sideB', at: T2 });
    expect(isDone(job, progress, DOOR)).toBe(true);
    expect(isDone(job, apply(job, {}, { kind: 'tick', partId: RAIL, step: 'cut', at: T1 }), RAIL)).toBe(true);
  });

  it('unticks a Step, and the Part is no longer Done', () => {
    const done = tickAll({}, SHELF);
    expect(isDone(job, done, SHELF)).toBe(true);
    const progress = apply(job, done, { kind: 'untick', partId: SHELF, step: 'banded' });
    expect(progress[SHELF]).toEqual({ cut: T1, manualOps: T1 });
    expect(isDone(job, progress, SHELF)).toBe(false);
    const railCut = apply(job, {}, { kind: 'tick', partId: RAIL, step: 'cut', at: T1 });
    expect(apply(job, railCut, { kind: 'untick', partId: RAIL, step: 'cut' })).toEqual({});
  });
});

describe('Bulk ticks', () => {
  it('"Side A done" ticks Cut on every Part of the Blank, keeping earlier ticks', () => {
    const shelfCut = apply(job, {}, { kind: 'tick', partId: SHELF, step: 'cut', at: T1 });
    expect(apply(job, shelfCut, { kind: 'sideADone', blankId: 'W18-1-A', at: T2 })).toEqual({
      [SHELF]: { cut: T1 },
      [DOOR]: { cut: T2 },
    });
  });

  it('"Breakdown done" ticks Cut on the Board\'s Saw Parts only', () => {
    expect(apply(job, {}, { kind: 'breakdownDone', boardId: 'W18-1', at: T1 })).toEqual({
      [LEFT]: { cut: T1 },
      [RAIL]: { cut: T1 },
    });
    expect(apply(job, {}, { kind: 'breakdownDone', boardId: 'O16-1', at: T1 })).toEqual({});
  });

  it('Side B per file ticks Side B on its Parts', () => {
    expect(apply(job, {}, { kind: 'sideBDone', fileId: 'B1', at: T1 })).toEqual({ [DOOR]: { sideB: T1 } });
  });

  it('ignores unknown Blanks, Boards and files', () => {
    expect(apply(job, {}, { kind: 'sideADone', blankId: 'W18-9-A', at: T1 })).toEqual({});
    expect(apply(job, {}, { kind: 'breakdownDone', boardId: 'W18-9', at: T1 })).toEqual({});
    expect(apply(job, {}, { kind: 'sideBDone', fileId: 'B9', at: T1 })).toEqual({});
  });
});

describe('Roll-ups', () => {
  // Cut on all of W18 Board 1; shelf and rail Done; the door banded but not run on Side B.
  let progress = apply(job, {}, { kind: 'sideADone', blankId: 'W18-1-A', at: T1 });
  progress = apply(job, progress, { kind: 'breakdownDone', boardId: 'W18-1', at: T1 });
  progress = tickAll(tickAll(progress, SHELF), RAIL);
  progress = apply(job, progress, { kind: 'tick', partId: DOOR, step: 'banded', at: T2 });

  it('count Cut and Done per Blank, Cut per Board and Sheet, and mark what is Locked', () => {
    const r = rollup(job, progress);
    expect(r.blanks).toEqual([
      { id: 'W18-1-A', cut: 2, done: 1, total: 2, locked: true },
      { id: 'O16-1-A', cut: 0, done: 0, total: 1, locked: false },
    ]);
    expect(r.boards).toEqual([
      { id: 'W18-1', sheetId: expect.any(String), cut: 4, total: 4, locked: true },
      { id: 'O16-1', sheetId: expect.any(String), cut: 0, total: 1, locked: false },
    ]);
    expect(r.sheets.map(({ code, cut, total }) => ({ code, cut, total }))).toEqual([
      { code: 'W18', cut: 4, total: 4 },
      { code: 'O16', cut: 0, total: 1 },
    ]);
  });

  it('count Done per Owner, Cabinets first, and the Job as a whole', () => {
    const r = rollup(job, progress);
    expect(r.owners).toEqual([
      { ownerId: 'c1', kind: 'cabinet', label: 'T1', done: 2, total: 4, readyToAssemble: false },
      { ownerId: 'w1.left.lower.c1/toeKick', kind: 'generatedItem', label: 'Toe Kick T1', done: 0, total: 1, readyToAssemble: false },
    ]);
    expect(r.job).toEqual({ cut: 4, done: 2, total: 5 });
  });

  it('call a Cabinet ready to assemble once all its Parts are Done; never a Generated Item', () => {
    const all = [LEFT, DOOR, TOE].reduce(tickAll, progress);
    const r = rollup(job, all);
    expect(r.owners.map((o) => [o.label, o.done, o.total, o.readyToAssemble])).toEqual([
      ['T1', 4, 4, true],
      ['Toe Kick T1', 1, 1, false],
    ]);
    expect(r.job).toEqual({ cut: 5, done: 5, total: 5 });
  });

  it('start at zero with no ticks', () => {
    const r = rollup(job, {});
    expect(r.job).toEqual({ cut: 0, done: 0, total: 5 });
    expect(r.boards.every((b) => !b.locked)).toBe(true);
  });
});

describe('Unticking Cut', () => {
  it('reports the Blank and Board it would unlock', () => {
    const doorCut = apply(job, {}, { kind: 'tick', partId: DOOR, step: 'cut', at: T1 });
    expect(wouldUnlock(job, doorCut, DOOR, 'cut')).toEqual(['W18-1-A', 'W18-1']);
  });

  it('reports only the Board when another Part keeps the Blank Locked, or a Saw Part was the last cut', () => {
    const railCut = apply(job, {}, { kind: 'tick', partId: RAIL, step: 'cut', at: T1 });
    expect(wouldUnlock(job, railCut, RAIL, 'cut')).toEqual(['W18-1']);
    const both = apply(job, railCut, { kind: 'tick', partId: DOOR, step: 'cut', at: T1 });
    expect(wouldUnlock(job, both, DOOR, 'cut')).toEqual(['W18-1-A']);
  });

  it('reports nothing for other Steps, Steps not ticked, or while the rest stays Locked', () => {
    const sideA = apply(job, {}, { kind: 'sideADone', blankId: 'W18-1-A', at: T1 });
    expect(wouldUnlock(job, sideA, DOOR, 'cut')).toEqual([]);
    expect(wouldUnlock(job, tickAll({}, DOOR), DOOR, 'banded')).toEqual([]);
    expect(wouldUnlock(job, {}, DOOR, 'cut')).toEqual([]);
  });
});

describe('Reprints after a regenerate', () => {
  it('select everything while nothing is cut', () => {
    expect(reprintSelection(job, {})).toEqual({
      boards: ['W18-1', 'O16-1'],
      blanks: ['W18-1-A', 'O16-1-A'],
      parts: [DOOR, SHELF, LEFT, RAIL, TOE],
      sideB: ['B1'],
    });
  });

  it('leave out Locked Boards and Blanks, the Parts on them and Done Parts, in Run order', () => {
    const railCut = apply(job, {}, { kind: 'tick', partId: RAIL, step: 'cut', at: T1 });
    expect(reprintSelection(job, railCut)).toEqual({ boards: ['O16-1'], blanks: ['O16-1-A'], parts: [TOE], sideB: [] });
  });
});

describe('A Remake Part greyed on its old Blank', () => {
  // The shelf and door were cut on W18-1-A, then the shelf marked Remake: greyed there, ticks cleared.
  const both = apply(job, apply(job, {}, { kind: 'tick', partId: SHELF, step: 'cut', at: T1 }), {
    kind: 'tick',
    partId: DOOR,
    step: 'cut',
    at: T1,
  });
  const marked = remake(job, both, SHELF);
  if ('error' in marked) throw new Error(marked.error);
  const remadeJob = marked.job;

  it('counts nowhere on that Blank, which stays Locked; it still counts for its Sheet', () => {
    const r = rollup(remadeJob, marked.progress);
    expect(r.blanks[0]).toEqual({ id: 'W18-1-A', cut: 1, done: 0, total: 1, locked: true });
    expect(r.boards[0]).toMatchObject({ id: 'W18-1', cut: 1, total: 3, locked: true });
    expect(r.sheets[0]).toMatchObject({ code: 'W18', cut: 1, total: 4 });
  });

  it('keeps the Blank and Board Locked when the last Cut on them is unticked', () => {
    expect(wouldUnlock(remadeJob, marked.progress, DOOR, 'cut')).toEqual([]);
  });

  it('is not ticked by "Side A done" on its old Blank', () => {
    const p = apply(remadeJob, {}, { kind: 'sideADone', blankId: 'W18-1-A', at: T2 });
    expect(Object.keys(p)).toEqual([DOOR]);
  });

  it('is reprinted, while its old Blank is not', () => {
    const r = reprintSelection(remadeJob, marked.progress);
    expect(r.blanks).toEqual(['O16-1-A']);
    expect(r.parts).toContain(SHELF);
  });
});
