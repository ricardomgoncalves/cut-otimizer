// Re-import on paper (ticket #39): Spares and the re-import log on the cut sheet cover, and the label
// batch for a re-import.
import { describe, expect, it } from 'vitest';
import { cutSheet, labels, type CutSheetJob, type Page, type QrItem } from '../src/core/documents/index.ts';
import type { ReimportLogEntry, Spare } from '../src/core/job-store/document.ts';
import { scanPayload } from '../src/core/progress.ts';
import { handModel, handPlan, mm } from './cut-sheet-plan.ts';
import { pageText, texts } from './page-text.ts';
import { decodeModules } from './qr-decode.ts';

const spares: Spare[] = [
  { partId: 'c1/oldShelf', displayName: 'B1 · Shelf 2', cutLength: mm(564), cutWidth: mm(519), thickness: mm(18), where: 'W18-1-A #3', at: '2026-11-25T08:30:00.000Z' },
  { partId: 'c1/oldRail', displayName: 'B1 · Rail', cutLength: mm(564), cutWidth: mm(40), thickness: mm(18), at: '2026-11-25T08:30:00.000Z' },
];

const reimportLog: ReimportLogEntry[] = [
  {
    at: '2026-11-25T08:30:00.000Z',
    exportedAt: '2026-11-25T08:00:00Z',
    fileName: 'kitchen-v2.parts.json',
    counts: { changedCut: 1, changedFinishing: 0, added: 2, removed: 2, renamed: 0, same: 3 },
  },
  {
    at: '2026-11-26T14:05:00.000Z',
    fileName: 'kitchen-v3.parts.json',
    counts: { changedCut: 0, changedFinishing: 1, added: 0, removed: 0, renamed: 4, same: 4 },
  },
];

const job: CutSheetJob = {
  name: 'Kitchen run',
  shortId: '7F3A',
  generatedAt: '2026-11-26 15:00',
  model: handModel,
  skipped: [],
  spares,
  reimportLog,
};

describe('cut sheet cover after re-imports', () => {
  const cover = cutSheet(handPlan, job)[0];

  it('lists the Spares in "Before you start" and in a table with their old name, size and location', () => {
    const t = texts(cover);
    expect(t).toContain('Spares: 2 cut Parts no longer in the export (B1 · Shelf 2, B1 · Rail): set them aside. They count nowhere.');
    expect(t).toEqual(expect.arrayContaining(['Spares', 'B1 · Shelf 2', '564 × 519 × 18', 'W18-1-A #3', 'B1 · Rail', '564 × 40 × 18', '—']));
  });

  it('prints the re-import log', () => {
    const t = texts(cover);
    expect(t).toEqual(
      expect.arrayContaining([
        'Re-import log',
        '2026-11-25 08:30',
        '2026-11-25 08:00',
        'kitchen-v2.parts.json',
        '1 Changed (cut) · 2 Added · 2 Removed · 3 Same',
        '2026-11-26 14:05',
        'kitchen-v3.parts.json',
        '1 Changed (finishing) · 4 Renamed · 4 Same',
      ]),
    );
  });

  it('says nothing of Spares or re-imports when there are none', () => {
    const t = texts(cutSheet(handPlan, { ...job, spares: [], reimportLog: [] })[0]);
    expect(t).toContain('Spares: none.');
    expect(t).not.toContain('Re-import log');
  });

  it('matches the golden page', async () => {
    await expect(pageText(cover as Page)).toMatchFileSnapshot('golden/cut-sheet-cover-reimport.txt');
  });
});

describe('the label batch for a re-import', () => {
  const added = { ...handModel.parts[3], id: 'c1/shelf2', displayName: 'B1 · Shelf 2' } as (typeof handModel.parts)[number];
  const model = { ...handModel, parts: [...handModel.parts, added] };
  const pages = labels(
    handPlan,
    { name: 'Kitchen run', shortId: '7F3A', model },
    { partIds: ['c1/shelf2', 'g1/toeKick', 'c1/door'], title: 'Labels for re-import' },
  );

  it('prints only those Parts, in label order, with Parts not nested yet last', () => {
    expect(pages).toHaveLength(1);
    const qrs = (pages[0]?.items ?? []).filter((it): it is QrItem => it.kind === 'qr');
    expect(qrs.map((q) => decodeModules(q.modules))).toEqual(
      ['c1/door', 'g1/toeKick', 'c1/shelf2'].map((id) => scanPayload('7F3A', id)),
    );
    expect(texts(pages[0])).toContain('Labels for re-import · Kitchen run · Job 7F3A · sheet 1 of 1');
    expect(texts(pages[0])).toContain('needs nesting');
  });

  it('matches the golden page', async () => {
    await expect(pageText(pages[0] as Page)).toMatchFileSnapshot('golden/labels-reimport-batch.txt');
  });
});
