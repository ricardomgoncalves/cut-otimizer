// What a re-import does to work already done (ticket #39): Remake, Fix by hand, voids, Changed
// (finishing) Steps, Spares and the label batch.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PartsExport } from '../src/core/import/parts-export.v1.generated.ts';
import { partLocations } from '../src/core/documents/index.ts';
import { labelOrder, reimportLabelOrder } from '../src/core/documents/labels.ts';
import { toDxfFiles } from '../src/core/dxf/index.ts';
import { importExport } from '../src/core/import/index.ts';
import { generateJob, needsNesting as needsNestingOf, regenerate, remake, type Job } from '../src/core/job.ts';
import {
  createJobDocument,
  dismissSpare,
  fromJobFile,
  openJobDocument,
  toJobFile,
  withJob,
  withProgress,
  type JobDocument,
} from '../src/core/job-store/document.ts';
import type { Model } from '../src/core/model.ts';
import type { Placement, Plan, SawPlacement } from '../src/core/planner/index.ts';
import { apply, rollup, steps, type Progress, type ProgressEvent } from '../src/core/progress.ts';
import { applyDiff, diff, voidText, type DiffChoices } from '../src/core/reimport.ts';
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

const NOW = '2026-11-24T10:00:00.000Z';
const TICK = '2026-11-24T11:00:00.000Z';
const LATER = '2026-11-25T08:30:00.000Z';

const fixtureText = readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8');

function exportWith(edit: (file: PartsExport) => void = () => undefined): PartsExport {
  const file = JSON.parse(fixtureText) as PartsExport;
  edit(file);
  return file;
}

function modelOf(file: PartsExport): Model {
  const { model, issues } = importExport(file);
  if (!model) throw new Error(`export must import: ${JSON.stringify(issues)}`);
  return model;
}

function part(file: PartsExport, id: string) {
  const p = file.parts.find((x) => x.id === id);
  if (!p) throw new Error(`no Part ${id}`);
  return p;
}

function opened(doc: JobDocument): Job {
  const o = openJobDocument(doc);
  if ('error' in o || !o.job) throw new Error('must open planned');
  return o.job;
}

/** The synthetic Job, planned, with these progress events applied. */
function documentWith(...events: ProgressEvent[]): JobDocument {
  const model = modelOf(exportWith());
  const doc = withJob(
    createJobDocument({
      id: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f',
      shortId: 'K7Q2',
      rawExport: fixtureText,
      fileName: 'kitchen.parts.json',
      model,
      settings: DEFAULT_SETTINGS,
      now: NOW,
    }),
    generateJob(model, DEFAULT_SETTINGS),
    NOW,
  );
  const job = opened(doc);
  return withProgress(doc, events.reduce<Progress>((p, e) => apply(job, p, e), {}), NOW);
}

const cut = (partId: string): ProgressEvent => ({ kind: 'tick', partId, step: 'cut', at: TICK });
const tick = (partId: string, step: 'banded' | 'manualOps' | 'sideB'): ProgressEvent => ({ kind: 'tick', partId, step, at: TICK });

function diffOf(doc: JobDocument, file: PartsExport, choices: DiffChoices = {}) {
  const o = openJobDocument(doc);
  if ('error' in o) throw new Error(o.error);
  return diff({ model: o.model, plan: doc.plan, progress: doc.progress }, modelOf(file), choices);
}

function reimport(doc: JobDocument, file: PartsExport, choices: DiffChoices = {}): JobDocument {
  const o = openJobDocument(doc);
  if ('error' in o) throw new Error(o.error);
  const next = modelOf(file);
  const d = diff({ model: o.model, plan: doc.plan, progress: doc.progress }, next, choices);
  return applyDiff(doc, o.model, { rawExport: JSON.stringify(file), fileName: 'v2.parts.json', model: next }, d, LATER);
}

/** Every placement of a Part in a Plan, on a Blank (with its Blank id) or as a Saw Part. */
function placements(plan: Plan | null, partId: string): { where: string; p: Placement | SawPlacement }[] {
  return (plan?.sheets ?? []).flatMap((s) =>
    s.boards.flatMap((b) => [
      ...b.blanks.flatMap((x) => x.parts.filter((p) => p.partId === partId).map((p) => ({ where: x.id, p }))),
      ...b.sawParts.filter((p) => p.partId === partId).map((p) => ({ where: `${s.code}-${String(b.number)} saw`, p })),
    ]),
  );
}

const narrower = (id: string, by = 2000) => (f: PartsExport) => {
  part(f, id).cutWidth -= by;
  part(f, id).width -= by;
};

describe('Changed (cut), already ticked Cut', () => {
  it('defaults to Remake: ticks cleared, greyed on its old Blank, needs nesting', () => {
    const doc = documentWith(cut(SHELF), cut(DOOR));
    const d = diffOf(doc, exportWith(narrower(SHELF)));
    expect(d.entries.find((e) => e.newId === SHELF)).toMatchObject({ category: 'changedCut', treatment: 'remake' });

    const after = reimport(doc, exportWith(narrower(SHELF)));
    expect(after.progress[SHELF]).toBeUndefined();
    expect(after.progress[DOOR]).toEqual({ cut: TICK });
    expect(placements(after.plan, SHELF)).toEqual([{ where: 'W18-1-A', p: expect.objectContaining({ remade: true }) }]);
    expect(after.stale?.needsNesting).toEqual([SHELF]);
  });
});

describe('Changed (cut), not cut yet', () => {
  it('on an unlocked Blank: taken off the stale Plan and nested at the next Regenerate', () => {
    const doc = documentWith();
    expect(diffOf(doc, exportWith(narrower(SHELF))).entries[0]).toMatchObject({ newId: SHELF, treatment: 'nest' });
    const after = reimport(doc, exportWith(narrower(SHELF)));
    expect(placements(after.plan, SHELF)).toEqual([]);
    expect(after.stale?.needsNesting).toEqual([SHELF]);

    const job = regenerate(opened(after), DEFAULT_SETTINGS, after.progress);
    const placed = placements(job.plan, SHELF);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.p).toMatchObject({ cutWidth: 517000 });
  });

  it('on a Locked Blank: leaves a greyed "moved to …" void; the Blank and its DXF stay as they are', () => {
    const doc = documentWith(cut(DOOR));
    const dxfBefore = toDxfFiles(opened(doc).plan, 'K7Q2').get('W18-1-A.side-a.dxf');
    const after = reimport(doc, exportWith(narrower(SHELF)));
    expect(placements(after.plan, SHELF)).toEqual([{ where: 'W18-1-A', p: expect.objectContaining({ voided: 'moved', cutWidth: 519000 }) }]);
    expect(after.stale?.needsNesting).toEqual([SHELF]);
    const stale = opened(after).plan;
    expect(voidText(stale, SHELF)).toBe('moved: needs nesting');

    const job = regenerate(opened(after), DEFAULT_SETTINGS, after.progress);
    const blankA = job.plan.sheets[0]?.boards[0]?.blanks[0];
    expect(blankA?.id).toBe('W18-1-A');
    expect(blankA?.parts.map((p) => [p.partId, p.voided ?? 'live'])).toEqual([
      [DOOR, 'live'],
      [SHELF, 'moved'],
    ]);
    expect(toDxfFiles(job.plan, 'K7Q2').get('W18-1-A.side-a.dxf')).toBe(dxfBefore);
    const nested = placements(job.plan, SHELF).filter((x) => x.p.voided === undefined);
    expect(nested).toHaveLength(1);
    expect(nested[0]?.where).not.toBe('W18-1-A');
    expect(voidText(job.plan, SHELF)).toBe(`moved to ${partLocations(job.plan).get(SHELF) ?? '?'}`);
  });

  it('a Saw Part on a Locked Board leaves a void in the Breakdown too', () => {
    const after = reimport(documentWith(cut(DOOR)), exportWith(narrower(RAIL, 1000)));
    expect(placements(after.plan, RAIL)).toEqual([{ where: 'W18-1 saw', p: expect.objectContaining({ voided: 'moved' }) }]);
    expect(after.stale?.needsNesting).toEqual([RAIL]);
  });
});

describe('Fix by hand', () => {
  const holeAt = (x: number, y: number) => (f: PartsExport) => {
    part(f, SHELF).ops.push({
      type: 'drill',
      face: 'top',
      at: { x: x * 1000, y: y * 1000 },
      diameter: 5000,
      through: true,
      source: { kind: 'op', index: 9 },
    });
  };

  it('keeps the ticks and adds an unticked Manual ops Step that describes the change', () => {
    const doc = documentWith(cut(SHELF), tick(SHELF, 'banded'), tick(SHELF, 'manualOps'));
    const file = exportWith(narrower(SHELF));
    // The diff shows what Fix by hand would say, whichever is chosen.
    expect(diffOf(doc, file).entries[0]).toMatchObject({ newId: SHELF, treatment: 'remake', fixText: 'now 517 wide' });
    expect(diffOf(doc, file, { fixByHand: [SHELF] }).entries[0]).toMatchObject({ newId: SHELF, treatment: 'fixByHand' });

    const after = reimport(doc, file, { fixByHand: [SHELF] });
    expect(after.progress[SHELF]).toEqual({ cut: TICK, banded: TICK });
    expect(after.handFixes).toEqual({ [SHELF]: ['now 517 wide'] });
    expect(placements(after.plan, SHELF)).toEqual([{ where: 'W18-1-A', p: expect.not.objectContaining({ remade: true }) }]);
    expect(after.stale?.needsNesting).toEqual([]);

    const job = opened(after);
    expect(job.plan.manualOps.filter((m) => m.partId === SHELF).map((m) => [m.reason, m.text])).toContainEqual([
      'fixByHand',
      'now 517 wide',
    ]);
    // Survives a regenerate: the Part stays on its Locked Blank, and the Manual op comes from the document.
    const regenerated = regenerate(job, DEFAULT_SETTINGS, after.progress);
    expect(placements(regenerated.plan, SHELF).map((x) => x.where)).toEqual(['W18-1-A']);
    expect(regenerated.plan.manualOps.some((m) => m.partId === SHELF && m.reason === 'fixByHand')).toBe(true);
  });

  it('describes an added hole', () => {
    const after = reimport(documentWith(cut(SHELF)), exportWith(holeAt(32, 96)), { fixByHand: [SHELF] });
    expect(after.handFixes[SHELF]).toEqual(['hole Ø5 added at 32, 96']);
  });

  it('describes several changes at once, and a second fix adds to the first', () => {
    const once = reimport(documentWith(cut(SHELF)), exportWith(holeAt(32, 96)), { fixByHand: [SHELF] });
    const twice = reimport(
      once,
      exportWith((f) => {
        holeAt(32, 96)(f);
        holeAt(64, 96)(f);
        holeAt(96, 96)(f);
        part(f, SHELF).cutLength -= 4000;
        part(f, SHELF).length -= 4000;
      }),
      { fixByHand: [SHELF] },
    );
    expect(twice.handFixes[SHELF]).toEqual([
      'hole Ø5 added at 32, 96',
      'now 560 long; hole Ø5 added at 64, 96 and at 96, 96',
    ]);
  });

  it('is not seen as a change of the Part by the next re-import', () => {
    const once = reimport(documentWith(cut(SHELF)), exportWith(holeAt(32, 96)), { fixByHand: [SHELF] });
    expect(diffOf(once, exportWith(holeAt(32, 96))).counts).toMatchObject({ same: 5 });
  });
});

const BAND = '1000000000000000201';
const edgeDrill = (id: string) => (f: PartsExport) => {
  part(f, id).ops.push({ type: 'drill', face: 'x0', at: { y: 20000, z: 9000 }, diameter: 8000, depth: 30000, source: { kind: 'op', index: 9 } });
};

describe('Changed (finishing)', () => {
  it('keeps Cut and Side B and clears only Banded when the Edgebands changed, flagging a ticked Step', () => {
    const doc = documentWith(cut(DOOR), tick(DOOR, 'sideB'), tick(DOOR, 'banded'));
    // Same thickness, other colour: the cut size and ops stay.
    const file = exportWith((f) => {
      f.materials.edgebands.push({ id: '1000000000000000202', name: 'Oak ABS 1 × 23', thickness: 1000, width: 23000 });
      part(f, DOOR).edges = { x0: BAND, xL: BAND, y0: '1000000000000000202', yW: BAND };
    });
    expect(diffOf(doc, file).entries[0]).toMatchObject({
      newId: DOOR,
      category: 'changedFinishing',
      treatment: 'clearSteps',
      flags: ['banding changed after it was banded'],
    });
    const after = reimport(doc, file);
    expect(after.progress[DOOR]).toEqual({ cut: TICK, sideB: TICK });
    expect(placements(after.plan, DOOR)).toEqual([{ where: 'W18-1-A', p: expect.not.objectContaining({ voided: 'moved' }) }]);
    expect(after.stale?.needsNesting).toEqual([]);
  });

  it('clears only Manual ops when those changed, and recomputes the applicable Steps', () => {
    const doc = documentWith(cut(SHELF), tick(SHELF, 'banded'), tick(SHELF, 'manualOps'), cut(RAIL));
    const file = exportWith((f) => {
      edgeDrill(SHELF)(f);
      edgeDrill(RAIL)(f);
    });
    const d = diffOf(doc, file);
    expect(d.entries.find((e) => e.newId === SHELF)?.flags).toEqual(['Manual ops changed after they were done']);
    expect(d.entries.find((e) => e.newId === RAIL)?.flags).toEqual([]);
    const after = reimport(doc, file);
    expect(after.progress[SHELF]).toEqual({ cut: TICK, banded: TICK });
    expect(after.progress[RAIL]).toEqual({ cut: TICK });
    expect(steps(opened(after), RAIL)).toEqual(['cut', 'manualOps']);
  });
});

describe('Removed', () => {
  it('not cut: dropped, with its ticks; off an unlocked Blank', () => {
    const doc = documentWith(tick(SHELF, 'banded'));
    const file = exportWith((f) => {
      f.parts = f.parts.filter((p) => p.id !== SHELF);
    });
    expect(diffOf(doc, file).entries.find((e) => e.oldId === SHELF)).toMatchObject({ category: 'removed', treatment: 'drop' });
    const after = reimport(doc, file);
    expect(after.progress).toEqual({});
    expect(placements(after.plan, SHELF)).toEqual([]);
    expect(after.spares).toEqual([]);
  });

  it('not cut, on a Locked Blank: leaves a void', () => {
    const after = reimport(
      documentWith(cut(DOOR)),
      exportWith((f) => {
        f.parts = f.parts.filter((p) => p.id !== SHELF);
      }),
    );
    expect(placements(after.plan, SHELF)).toEqual([{ where: 'W18-1-A', p: expect.objectContaining({ voided: 'removed' }) }]);
    const job = regenerate(opened(after), DEFAULT_SETTINGS, after.progress);
    expect(placements(job.plan, SHELF).map((x) => x.p.voided)).toEqual(['removed']);
    expect(voidText(job.plan, SHELF)).toBe('removed from the export');
  });

  it('cancels a pending Remake', () => {
    const doc = documentWith(cut(SHELF), cut(DOOR));
    const job = opened(doc);
    const marked = remake(job, doc.progress, SHELF);
    if ('error' in marked) throw new Error(marked.error);
    const remadeDoc = withProgress({ ...doc, plan: marked.job.plan }, marked.progress, NOW);
    const file = exportWith((f) => {
      f.parts = f.parts.filter((p) => p.id !== SHELF);
    });
    expect(diffOf(remadeDoc, file).entries.find((e) => e.oldId === SHELF)?.treatment).toBe('drop');
    const after = reimport(remadeDoc, file);
    expect(after.stale?.needsNesting).toEqual([]);
    const regenerated = regenerate(opened(after), DEFAULT_SETTINGS, after.progress);
    expect(placements(regenerated.plan, SHELF).map((x) => x.p.remade)).toEqual([true]);
    expect(needsNestingOf(regenerated)).toEqual([]);
  });
});

describe('Spares', () => {
  const removeShelf = exportWith((f) => {
    f.parts = f.parts.filter((p) => p.id !== SHELF);
  });

  it('a Removed Part already cut becomes a Spare with its old name, size and location', () => {
    const doc = documentWith(cut(SHELF), tick(SHELF, 'banded'));
    expect(diffOf(doc, removeShelf).entries.find((e) => e.oldId === SHELF)?.treatment).toBe('spare');
    const after = reimport(doc, removeShelf);
    expect(after.spares).toEqual([
      { partId: SHELF, displayName: 'T1 · Shelf', cutLength: 564000, cutWidth: 519000, thickness: 18000, where: 'W18-1-A #2', at: LATER },
    ]);
    // Its ticks stay under its old id, so its Blank stays Locked; it is greyed there as a Spare.
    expect(after.progress[SHELF]).toEqual({ cut: TICK, banded: TICK });
    expect(placements(after.plan, SHELF)).toEqual([{ where: 'W18-1-A', p: expect.objectContaining({ voided: 'spare' }) }]);
  });

  it('is left out of every roll-up', () => {
    const after = reimport(documentWith(cut(SHELF), cut(DOOR)), removeShelf);
    const r = rollup(opened(after), after.progress);
    expect(r.blanks.find((b) => b.id === 'W18-1-A')).toEqual({ id: 'W18-1-A', cut: 1, done: 0, total: 1, locked: true });
    expect(r.boards.find((b) => b.id === 'W18-1')).toMatchObject({ cut: 1, total: 3 });
    expect(r.sheets.find((s) => s.code === 'W18')).toMatchObject({ cut: 1, total: 3 });
    expect(r.owners.find((o) => o.label === 'T1')).toMatchObject({ total: 3 });
    expect(r.job).toMatchObject({ cut: 1, total: 4 });
  });

  it('can be dismissed, and survives .job.json until then', () => {
    const after = reimport(documentWith(cut(SHELF)), removeShelf);
    expect(fromJobFile(toJobFile(after))).toEqual({ doc: after });
    const dismissed = dismissSpare(after, SHELF, LATER);
    expect(dismissed.spares).toEqual([]);
    expect(dismissed.progress[SHELF]).toEqual({ cut: TICK });
  });
});

describe('Print labels for this re-import', () => {
  it('lists the Renamed, Changed and Added Parts, in Run order', () => {
    const doc = documentWith(cut(DOOR));
    const NEW = 'c1/s0.shelf[1]';
    const after = reimport(
      doc,
      exportWith((f) => {
        narrower(SHELF)(f);
        part(f, DOOR).edges = {};
        const cabinet = f.cabinets[0];
        if (cabinet) cabinet.label = 'T9';
        f.parts.push({ ...part(f, RAIL), id: NEW, name: 's0.shelf[1]', cutWidth: 300000, width: 300000 });
        f.parts = f.parts.filter((p) => p.id !== TOE);
      }),
    );
    expect(after.reimportLog.at(-1)?.labelIds).toEqual([SHELF, DOOR, NEW, LEFT, RAIL]);

    const job = regenerate(opened(after), DEFAULT_SETTINGS, after.progress);
    const batch = reimportLabelOrder(job.plan, after.reimportLog.at(-1)?.labelIds ?? []);
    expect(batch).toEqual(labelOrder(job.plan).filter((e) => [SHELF, DOOR, NEW, LEFT, RAIL].includes(e.partId)));
    expect(batch.map((e) => e.partId).sort()).toEqual([DOOR, LEFT, NEW, RAIL, SHELF].sort());
  });

  it('puts Parts not nested yet last, as needing nesting', () => {
    const after = reimport(documentWith(cut(DOOR)), exportWith(narrower(SHELF)));
    expect(reimportLabelOrder(opened(after).plan, [SHELF])).toEqual([{ partId: SHELF, where: 'needs nesting' }]);
  });
});
