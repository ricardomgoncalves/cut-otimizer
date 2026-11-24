import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PartsExport } from '../src/core/import/parts-export.v1.generated.ts';
import { importExport } from '../src/core/import/index.ts';
import { applyDiff, diff, revertReimport } from '../src/core/reimport.ts';
import { generateJob, regenerate, sheetCode, type Job } from '../src/core/job.ts';
import {
  createJobDocument,
  fromJobFile,
  openJobDocument,
  toJobFile,
  withJob,
  withProgress,
  type JobDocument,
} from '../src/core/job-store/document.ts';
import { apply, resolveAlias, steps } from '../src/core/progress.ts';
import type { Model } from '../src/core/model.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';

// The synthetic fixture, planned with default settings:
//   W18 Board 1: Blank W18-1-A = door (#1), shelf (#2); Saw Parts leftSide, rail.
//   O16 Board 1: Blank O16-1-A = toe kick.
const LEFT = 'c1/leftSide';
const SHELF = 'c1/s0.shelf[0]';
const RAIL = 'c1/s0.rail[1]';
const DOOR = 'c1/s0.door.leaf[0]';
const TOE = 'w1.left.lower.c1/toeKick/0';
const WHITE = '1000000000000000101';

const fixtureText = readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8');

/** A copy of the synthetic export, changed by `edit`. */
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

const job: Job = generateJob(modelOf(exportWith()), DEFAULT_SETTINGS);

describe('Matching by Part id', () => {
  it('finds every Part the Same in an unchanged export', () => {
    const d = diff(job, modelOf(exportWith()));
    expect(d.counts).toEqual({ same: 5, renamed: 0, changedCut: 0, changedFinishing: 0, added: 0, removed: 0 });
    expect(d.entries.map((e) => [e.oldId, e.newId])).toEqual([
      [LEFT, LEFT],
      [SHELF, SHELF],
      [RAIL, RAIL],
      [DOOR, DOOR],
      [TOE, TOE],
    ]);
  });

  it('gives a sanity hint: same Project name and the share of Part ids that match', () => {
    const d = diff(job, modelOf(exportWith()));
    expect(d.hint).toEqual({
      currentProject: 'Synthetic fixture',
      newProject: 'Synthetic fixture',
      sameProject: true,
      idMatchShare: 1,
      lowOverlap: false,
    });
  });

  it('warns, without blocking, when under about half of the Part ids match', () => {
    const file = exportWith((f) => {
      f.project.name = 'Other kitchen';
      for (const p of f.parts.slice(0, 3)) p.id = `x/${p.id}`;
    });
    const d = diff(job, modelOf(file));
    expect(d.hint.sameProject).toBe(false);
    expect(d.hint.idMatchShare).toBeCloseTo(2 / 5);
    expect(d.hint.lowOverlap).toBe(true);
  });
});

const byId = (d: ReturnType<typeof diff>, id: string) => d.entries.find((e) => e.newId === id || e.oldId === id);

describe('Categories', () => {
  it('Renamed: only the Owner label and so the display names changed', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      const cabinet = f.cabinets[0];
      if (cabinet) cabinet.label = 'T9';
    })));
    expect(d.counts).toMatchObject({ renamed: 4, same: 1 });
    expect(byId(d, SHELF)).toMatchObject({
      category: 'renamed',
      displayName: 'T9 · Shelf',
      oldDisplayName: 'T1 · Shelf',
      ownerLabel: 'T9',
      where: 'W18-1-A #2',
    });
    expect(d.owners.renamed).toEqual(['T9']);
  });

  it('Changed (cut): size, grain or CNC ops changed', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      part(f, SHELF).cutWidth -= 2000;
      part(f, SHELF).width -= 2000;
      part(f, RAIL).ops.push({ type: 'drill', face: 'top', at: { x: 100000, y: 20000 }, diameter: 5000, depth: 10000, source: { kind: 'op', index: 0 } });
    })));
    expect(byId(d, SHELF)).toMatchObject({ category: 'changedCut', changes: ['size'] });
    expect(byId(d, RAIL)).toMatchObject({ category: 'changedCut', changes: ['cncOps'] });
    expect(d.counts).toMatchObject({ changedCut: 2, same: 3 });
  });

  it('Changed (finishing): only Edgebands or Manual ops changed', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      part(f, RAIL).edges = { y0: '1000000000000000201' };
      part(f, LEFT).ops.push({ type: 'drill', face: 'x0', at: { y: 100000, z: 9000 }, diameter: 8000, depth: 30000, source: { kind: 'op', index: 0 } });
    })));
    expect(byId(d, RAIL)).toMatchObject({ category: 'changedFinishing', changes: ['edgebands'] });
    expect(byId(d, LEFT)).toMatchObject({ category: 'changedFinishing', changes: ['manualOps'], where: 'Saw · W18-1' });
    expect(d.owners.changedFinishing).toEqual(['T1']);
  });

  it('Added and Removed: no match by id or by pairing', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      f.parts = f.parts.filter((p) => p.id !== RAIL);
      f.parts.push({ ...part(f, SHELF), id: 'c1/s0.shelf[1]', name: 's0.shelf[1]', cutWidth: 300000, width: 301000 });
    })));
    expect(byId(d, 'c1/s0.shelf[1]')).toMatchObject({ category: 'added', paired: false, changes: [] });
    expect(byId(d, 'c1/s0.shelf[1]')?.oldId).toBeUndefined();
    expect(byId(d, RAIL)).toMatchObject({ category: 'removed', displayName: 'T1 · Rail', where: 'Saw · W18-1' });
    expect(byId(d, RAIL)?.newId).toBeUndefined();
    // A second shelf numbers the first one: "T1 · Shelf" becomes "T1 · Shelf 1".
    expect(d.counts).toMatchObject({ added: 1, removed: 1, renamed: 1, same: 3 });
  });

  it('a changed Sheet definition makes every Part on it Changed (cut)', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      const white = f.materials.sheets.find((s) => s.id === WHITE);
      if (white) white.sheetWidth = 1830000;
    })));
    expect(d.changedSheets).toEqual([WHITE]);
    for (const id of [LEFT, SHELF, RAIL, DOOR]) {
      expect(byId(d, id)).toMatchObject({ category: 'changedCut', changes: ['sheetDefinition'] });
    }
    expect(byId(d, TOE)?.category).toBe('same');
  });

  it('groups entries by category in the diff screen order', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      f.parts = f.parts.filter((p) => p.id !== RAIL);
      part(f, SHELF).edges = {};
      part(f, DOOR).cutLength -= 1000;
      part(f, DOOR).length -= 1000;
    })));
    expect(d.entries.map((e) => e.category)).toEqual(['changedCut', 'changedFinishing', 'removed', 'same', 'same']);
  });
});

describe('Auto-pairing', () => {
  const NEW_TOE = 'w1.left.lower.c3/toeKick/0';
  const renamedToeKick = exportWith((f) => {
    const item = f.generatedItems[0];
    if (item) {
      item.id = 'w1.left.lower.c3/toeKick';
      item.label = 'Toe Kick T3';
    }
    part(f, TOE).id = NEW_TOE;
    part(f, NEW_TOE).owner.id = 'w1.left.lower.c3/toeKick';
  });

  it('pairs a renamed Generated Item Part as Renamed and records the id change', () => {
    const d = diff(job, modelOf(renamedToeKick));
    expect(byId(d, NEW_TOE)).toMatchObject({
      category: 'renamed',
      oldId: TOE,
      newId: NEW_TOE,
      paired: true,
      displayName: 'Toe Kick T3',
      oldDisplayName: 'Toe Kick T1',
      where: 'O16-1-A #1',
    });
    expect(d.renames).toEqual({ [TOE]: NEW_TOE });
    expect(d.counts).toMatchObject({ renamed: 1, added: 0, removed: 0 });
  });

  it('does not pair Parts that differ in size, ops, Edgebands or Owner kind', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      part(f, TOE).id = 'w1.left.lower.c1/toeKick/9';
      part(f, 'w1.left.lower.c1/toeKick/9').cutLength -= 1000;
      part(f, 'w1.left.lower.c1/toeKick/9').length -= 1000;
    })));
    expect(d.counts).toMatchObject({ added: 1, removed: 1 });
  });

  it('pairs a repeat-count rename (same Part path, new index)', () => {
    const d = diff(job, modelOf(exportWith((f) => {
      part(f, SHELF).name = 's0.shelf[3]';
      part(f, SHELF).id = 'c1/s0.shelf[3]';
    })));
    expect(byId(d, 'c1/s0.shelf[3]')).toMatchObject({ category: 'renamed', oldId: SHELF, paired: true });
  });

  it('pairs identical candidates in Run order', () => {
    const twoShelves = (ids: [string, string]) =>
      exportWith((f) => {
        const shelf = part(f, SHELF);
        f.parts = f.parts.filter((p) => p.id !== SHELF);
        f.parts.splice(1, 0, ...ids.map((id) => ({ ...shelf, id: `c1/${id}`, name: id })));
      });
    const before = generateJob(modelOf(twoShelves(['s0.shelf[0]', 's0.shelf[1]'])), DEFAULT_SETTINGS);
    const d = diff(before, modelOf(twoShelves(['s0.shelf[5]', 's0.shelf[6]'])));
    const pairs = d.entries.filter((e) => e.paired).map((e) => [e.where, e.newId]);
    const byRunOrder = [...pairs].sort(([a], [b]) => String(a).localeCompare(String(b), 'en', { numeric: true }));
    expect(pairs).toHaveLength(2);
    expect(byRunOrder.map(([, id]) => id)).toEqual(['c1/s0.shelf[5]', 'c1/s0.shelf[6]']);
  });

  it('lets the maker unpair a pair: it becomes Removed and Added', () => {
    const d = diff(job, modelOf(renamedToeKick), { unpaired: [{ oldId: TOE, newId: NEW_TOE }] });
    expect(byId(d, NEW_TOE)).toMatchObject({ category: 'added', paired: false });
    expect(byId(d, TOE)).toMatchObject({ category: 'removed' });
    expect(d.renames).toEqual({});
  });
});

describe('Export dates', () => {
  it('warns when the new file was exported before the current one', () => {
    const older = diff(job, modelOf(exportWith((f) => {
      f.exportedAt = '2026-11-01T09:00:00Z';
    })));
    expect(older.olderExport).toBe(true);
    expect(older.currentExportedAt).toBe('2026-11-24T12:00:00Z');
    expect(diff(job, modelOf(exportWith((f) => {
      f.exportedAt = '2026-12-01T09:00:00Z';
    }))).olderExport).toBe(false);
  });
});

const NOW = '2026-11-24T10:00:00.000Z';
const LATER = '2026-11-25T08:30:00.000Z';
const TICK = '2026-11-24T11:00:00.000Z';

/** The synthetic Job, planned, as stored. */
function plannedDocument(): JobDocument {
  const model = modelOf(exportWith());
  const doc = createJobDocument({
    id: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f',
    shortId: 'K7Q2',
    rawExport: fixtureText,
    fileName: 'kitchen.parts.json',
    model,
    settings: DEFAULT_SETTINGS,
    now: NOW,
  });
  return withJob(doc, generateJob(model, DEFAULT_SETTINGS), NOW);
}

/** Diffs and applies `file` to `doc`, as the diff screen does. */
function reimport(doc: JobDocument, file: PartsExport, fileName = 'kitchen-v2.parts.json'): JobDocument {
  const opened = openJobDocument(doc);
  if ('error' in opened) throw new Error(opened.error);
  const next = modelOf(file);
  const d = diff({ model: opened.model, plan: doc.plan }, next);
  return applyDiff(doc, opened.model, { rawExport: JSON.stringify(file), fileName, model: next }, d, LATER);
}

function tickedDocument(partId: string): JobDocument {
  const doc = plannedDocument();
  const opened = openJobDocument(doc);
  if ('error' in opened || !opened.job) throw new Error('must open');
  return withProgress(doc, apply(opened.job, {}, { kind: 'tick', partId, step: 'cut', at: TICK }), NOW);
}

const NEW_TOE = 'w1.left.lower.c3/toeKick/0';
const renamedToeKick = () =>
  exportWith((f) => {
    const item = f.generatedItems[0];
    if (item) {
      item.id = 'w1.left.lower.c3/toeKick';
      item.label = 'Toe Kick T3';
    }
    part(f, TOE).id = NEW_TOE;
    part(f, NEW_TOE).owner.id = 'w1.left.lower.c3/toeKick';
  });

describe('Applying a re-import', () => {
  it('replaces the raw export and keeps the Job name and settings snapshot', () => {
    const before = { ...plannedDocument(), name: 'Kitchen', settings: { ...DEFAULT_SETTINGS, sawKerf: 4000 } };
    const file = renamedToeKick();
    const after = reimport(before, file);
    expect(after.rawExport).toBe(JSON.stringify(file));
    expect(after.fileName).toBe('kitchen-v2.parts.json');
    expect(after.name).toBe('Kitchen');
    expect(after.settings).toEqual(before.settings);
    expect(after.updatedAt).toBe(LATER);
  });

  it('marks the Layouts stale with the Parts that need nesting, and keeps the Plan until Regenerate', () => {
    const after = reimport(
      plannedDocument(),
      exportWith((f) => {
        part(f, SHELF).cutWidth -= 2000;
        part(f, SHELF).width -= 2000;
        f.parts.push({ ...part(f, RAIL), id: 'c1/s0.rail[2]', name: 's0.rail[2]', cutLength: 300000, length: 300000 });
      }),
    );
    expect(after.stale).toEqual({ needsNesting: [SHELF, 'c1/s0.rail[2]'] });
    const blanks = after.plan?.sheets.flatMap((s) => s.boards.flatMap((b) => b.blanks.map((x) => x.id)));
    expect(blanks).toEqual(['W18-1-A', 'O16-1-A']);
  });

  it('moves a renamed Part to its new id in the stale Plan', () => {
    const after = reimport(plannedDocument(), renamedToeKick());
    const ids = after.plan?.sheets.flatMap((s) =>
      s.boards.flatMap((b) => b.blanks.flatMap((x) => x.parts.map((p) => p.partId))),
    );
    expect(ids).toContain(NEW_TOE);
    expect(ids).not.toContain(TOE);
    expect(after.stale).toEqual({ needsNesting: [] });
  });

  it("moves a Part's ticks to its new id, and the old id still resolves through the alias", () => {
    const after = reimport(tickedDocument(TOE), renamedToeKick());
    expect(after.progress).toEqual({ [NEW_TOE]: { cut: TICK } });
    expect(after.idAliases).toEqual({ [TOE]: NEW_TOE });
    expect(resolveAlias(after.idAliases, TOE)).toBe(NEW_TOE);
    expect(resolveAlias(after.idAliases, SHELF)).toBe(SHELF);

    const reopened = openJobDocument(after);
    if ('error' in reopened || !reopened.job) throw new Error('must open');
    expect(steps(reopened.job, resolveAlias(after.idAliases, TOE))).toEqual(['cut']);
  });

  it('keeps the id alias permanently, following later renames', () => {
    const once = reimport(plannedDocument(), renamedToeKick());
    const LAST = 'w1.left.lower.c5/toeKick/0';
    const twice = reimport(
      once,
      exportWith((f) => {
        const item = f.generatedItems[0];
        if (item) {
          item.id = 'w1.left.lower.c5/toeKick';
          item.label = 'Toe Kick T5';
        }
        part(f, TOE).id = LAST;
        part(f, LAST).owner.id = 'w1.left.lower.c5/toeKick';
      }),
    );
    expect(twice.idAliases).toEqual({ [TOE]: LAST, [NEW_TOE]: LAST });
    // Renamed back: the first id is live again, so it is no longer an alias.
    const back = reimport(twice, exportWith());
    expect(back.idAliases).toEqual({ [NEW_TOE]: TOE, [LAST]: TOE });
  });

  it('logs the date, the export date and the counts per category', () => {
    const after = reimport(plannedDocument(), renamedToeKick());
    expect(after.reimportLog).toEqual([
      {
        at: LATER,
        exportedAt: '2026-11-24T12:00:00Z',
        fileName: 'kitchen-v2.parts.json',
        counts: { changedCut: 0, changedFinishing: 0, added: 0, removed: 0, renamed: 1, same: 4 },
        labelIds: [NEW_TOE],
      },
    ]);
  });

  it('recomputes the Skipped-items warning from the new file', () => {
    const after = reimport(
      plannedDocument(),
      exportWith((f) => {
        f.skipped = [];
      }),
    );
    const opened = openJobDocument(after);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.issues.filter((i) => i.kind === 'skipped')).toEqual([]);
  });
});

describe('Sheet codes after a re-import', () => {
  const OAK = '1000000000000000104';
  const codesOf = (doc: JobDocument) => {
    const opened = openJobDocument(doc);
    if ('error' in opened || !opened.job) throw new Error('must open');
    const job = opened.job;
    return Object.fromEntries(job.model.sheets.map((s) => [s.id, sheetCode(job, s.id)]));
  };

  it('carry over by Sheet id', () => {
    const edited = { ...plannedDocument(), sheetCodes: { [WHITE]: 'WH18' } };
    expect(codesOf(reimport(edited, exportWith()))).toEqual({ [WHITE]: 'WH18', [OAK]: 'O16' });
  });

  it('re-derive a derived code when its Sheet changed', () => {
    const after = reimport(
      plannedDocument(),
      exportWith((f) => {
        const white = f.materials.sheets.find((s) => s.id === WHITE);
        if (white) {
          white.name = 'Grey melamine 19';
          white.thickness = 19000;
        }
        for (const p of f.parts) if (p.sheetId === WHITE) p.thickness = 19000;
      }),
    );
    expect(codesOf(after)[WHITE]).toBe('G19');
  });

  it("keep an unchanged Sheet's code when a new Sheet would take it; new Sheets get derived codes", () => {
    const after = reimport(
      plannedDocument(),
      exportWith((f) => {
        // Sorts before the White Sheet (shorter id), so Import alone would call it W18 and White W18B.
        f.materials.sheets.unshift({
          id: '100',
          name: 'Walnut 18',
          thickness: 18000,
          sheetLength: 2800000,
          sheetWidth: 2070000,
          grain: 'length',
        });
        f.parts.push({ ...part(f, RAIL), id: 'c1/s0.rail[2]', name: 's0.rail[2]', sheetId: '100' });
      }),
    );
    expect(codesOf(after)).toEqual({ '100': 'W18B', [WHITE]: 'W18', [OAK]: 'O16' });
  });
});

describe('The re-imported Job document', () => {
  it('round-trips through .job.json with its alias, log, stale flag and previous document', () => {
    const after = reimport(tickedDocument(TOE), renamedToeKick());
    expect(fromJobFile(toJobFile(after))).toEqual({ doc: after });
  });

  it('opens files saved before re-import existed', () => {
    const fields = new Set(['idAliases', 'reimportLog', 'stale', 'previous']);
    const old = Object.fromEntries(Object.entries(plannedDocument()).filter(([key]) => !fields.has(key)));
    const read = fromJobFile(JSON.stringify(old));
    expect(read).toMatchObject({ doc: { idAliases: {}, reimportLog: [], stale: null, previous: null } });
  });
});

describe('Reverting the last re-import', () => {
  it('gives back the identical Job document', () => {
    const before = tickedDocument(TOE);
    const after = reimport(before, renamedToeKick());
    expect(revertReimport(after)).toEqual(before);
  });

  it('lasts until the next regenerate or re-import (one level)', () => {
    const after = reimport(plannedDocument(), renamedToeKick());
    const opened = openJobDocument(after);
    if ('error' in opened || !opened.job) throw new Error('must open');
    const regenerated = withJob(after, regenerate(opened.job, DEFAULT_SETTINGS), LATER);
    expect(revertReimport(regenerated)).toBeNull();
    expect(regenerated.stale).toBeNull();

    const again = reimport(after, exportWith());
    const reverted = revertReimport(again);
    expect(reverted).toEqual({ ...after, previous: null });
    expect(reverted && revertReimport(reverted)).toBeNull();
  });
});
