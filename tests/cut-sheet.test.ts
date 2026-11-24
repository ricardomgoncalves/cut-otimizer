import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutSheet, pageToSvg, type CutSheetJob, type Page } from '../src/core/documents/index.ts';
import { sawCuts } from '../src/core/documents/saw.ts';
import { importExport } from '../src/core/import/index.ts';
import { plan, type Board, type Plan, type SheetPlan } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS, edgeTrimFor } from '../src/core/settings.ts';
import { pagesToPdf } from '../src/shell/pdf.ts';
import { PDFDocument } from 'pdf-lib';
import { handModel, handPlan, mm, offcutBoard } from './cut-sheet-plan.ts';
import { pageText as describe_, texts } from './page-text.ts';

const nameOf = (id: string) => handModel.parts.find((p) => p.id === id)?.displayName ?? id;

function firstBoard(p: Plan, sheetIndex = 0): { sheet: SheetPlan; board: Board } {
  const sheet = p.sheets[sheetIndex];
  const board = sheet?.boards[0];
  if (!sheet || !board) throw new Error('no Board');
  return { sheet, board };
}

describe('sawCuts: the cut table of a Board', () => {
  it('sets the fence to the near side of the blade, measured from the last cut edge (kerf and trim included)', () => {
    const { sheet, board } = firstBoard(handPlan);

    expect(sawCuts(handPlan, sheet, board, nameOf)).toEqual([
      { label: '1', kind: 'rip', fence: mm(600), from: 'Front edge (after trim)', gives: 'Strip 1 · 600 wide' },
      { label: '1a', kind: 'cross', fence: mm(1000), from: 'Left end (after trim)', gives: 'W18-1-A · 1000 × 600' },
      { label: '1b', kind: 'cross', fence: mm(1700), from: 'Cut 1a', gives: 'SAW · B1 · Back · 1700 × 600' },
      { label: '2', kind: 'rip', fence: mm(400), from: 'Cut 1', gives: 'Strip 2 · 400 wide' },
      { label: '2a', kind: 'cross', fence: mm(1300), from: 'Left end (after trim)', gives: 'W18-1-B · 1300 × 400' },
    ]);
  });

  it('gives a kept Offcut cut up later saw entries of its own, measured from its edges', () => {
    const { sheet } = firstBoard(handPlan);
    const rows = sawCuts(handPlan, sheet, offcutBoard(), nameOf);

    expect(rows.slice(5)).toEqual([
      {
        label: 'K1.1',
        kind: 'rip',
        fence: mm(300),
        from: 'Front edge of W18-1-K1',
        gives: 'Strip K1.1 · 300 wide',
        offcut: 'W18-1-K1',
      },
      {
        label: 'K1.1a',
        kind: 'cross',
        fence: mm(700),
        from: 'Left end of W18-1-K1',
        gives: 'W18-1-C · 700 × 300',
        offcut: 'W18-1-K1',
      },
    ]);
  });

  it('measures from the raw edges when there is no edge trim', () => {
    const { sheet, board } = firstBoard(handPlan, 1);

    expect(sawCuts(handPlan, sheet, board, nameOf).map((c) => [c.label, c.fence, c.from])).toEqual([
      ['1', mm(229), 'Front edge'],
      ['1a', mm(700), 'Left end'],
    ]);
  });

  it('replays to the Breakdown geometry on a planned fixture: fence + kerf steps land on every cut', () => {
    const json: unknown = JSON.parse(readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8'));
    const { model } = importExport(json);
    if (!model) throw new Error('fixture did not import');
    const settings = { ...DEFAULT_SETTINGS, edgeTrim: mm(7), sawKerf: mm(4) };
    const planned = plan(model, settings);
    let checked = 0;

    for (const sheet of planned.sheets) {
      const trim = edgeTrimFor(settings, sheet.sheetId);
      for (const board of sheet.boards) {
        const rows = sawCuts(planned, sheet, board, (id) => id);
        // Replay: the fence is set from the last cut edge (or the trimmed edge), the blade cuts its kerf beyond.
        let ripEdge = trim;
        let crossEdge = trim;
        let strip = '';
        rows.forEach((row, i) => {
          const cut = board.cuts[i];
          if (!cut) throw new Error('row without a cut');
          expect(row.label).toBe(cut.label);
          const rowStrip = /^\d+/.exec(row.label)?.[0] ?? '';
          if (rowStrip !== strip) crossEdge = trim; // a new strip starts at its left end
          strip = rowStrip;
          if (row.kind === 'rip') {
            expect(ripEdge + row.fence).toBe(cut.y);
            ripEdge = cut.y + settings.sawKerf;
          } else {
            expect(crossEdge + row.fence).toBe(cut.x);
            crossEdge = cut.x + settings.sawKerf;
          }
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(2);
  });
});

const job: CutSheetJob = {
  name: 'Kitchen run',
  shortId: '7F3A',
  generatedAt: '2026-11-24 10:30',
  model: handModel,
  skipped: [{ label: 'T2', name: 'Tall 1', reason: 'invalid' }],
};

describe('cutSheet: cover and saw pages', () => {
  const pages = cutSheet(handPlan, job);

  it('starts with a cover, then one saw page per Board in Run order', () => {
    expect(texts(pages[3])[0]).toMatch(/^2 · CNC Side A/);
    expect(texts(pages[1])).toContain('1 · Saw · W18 · Board 1 of 1');
    expect(texts(pages[2])).toContain('1 · Saw · O16 · Board 1 of 1');
    pages.forEach((p, i) => {
      expect(p).toMatchObject({ width: 210, height: 297 });
      expect(texts(p)).toContain(`Page ${String(i + 1)} of ${String(pages.length)}`);
    });
  });

  it('cover: job, counts, order of work, before-you-start, materials, settings, edgebanding and layers', async () => {
    const t = texts(pages[0]);
    expect(t).toContain('Cut sheet · Kitchen run');
    expect(t).toContain('Job 7F3A · generated 2026-11-24 10:30');
    expect(t).toContain('5 Parts · 2 Boards · 3 Blanks · 1 Side B file');
    expect(t).toContain('1. Saw: break each Board into Blanks and Saw Parts (pages 2–3)');
    expect(t).toContain('Saw Parts: 1 (B1 · Back), cut on the saw, not on the CNC.');
    expect(t).toContain('Manual ops: 1 on 1 Part, done by hand.');
    expect(t).toContain('Skipped items: T2 · Tall 1 (invalid). This Job is incomplete.');
    // Materials: W18 row then O16 row.
    expect(t).toEqual(expect.arrayContaining(['White melamine 18 · 2800 × 2070 · grain none', 'W18', 'Oak MDF 16 · 2440 × 1220 · grain length', 'O16']));
    expect(t).toContain('Outlines need tabs or onion skin in CAM');
    // Edgeband: 6 edges, 700 + 4 door edges (300 + 300 + 200 + 200) + 620 = 2320 mm, +10% = 2.552 m.
    expect(t).toEqual(expect.arrayContaining(['White ABS 1 × 23', '6', '2.6 m']));
    // Layers: Side A outlines and ops, the Side B cup; reference layers last.
    expect(t).toEqual(
      expect.arrayContaining(['OUTLINE_THRU', 'DRILL_D5_Z12', 'GROOVE_W8_Z8', 'DRILL_D35_Z13', 'Reference layers, never cut: REF_V1 · REF_BLANK · REF_CLAMP · REF_PART']),
    );
    await expect(describe_(pages[0] as Page)).toMatchFileSnapshot('golden/cut-sheet-cover.txt');
  });

  it('saw page: drawing, numbered cuts, cut table with fence settings, footnote', async () => {
    const t = texts(pages[1]);
    expect(t).toEqual(expect.arrayContaining(['W18-1-A', 'W18-1-B', 'SAW · B1 · Back', '1', '1a', '1b', '2', '2a']));
    // Cut table rows.
    expect(t).toEqual(expect.arrayContaining(['Rip', 'Cross', '600', '1000', '1700', '400', '1300', 'Cut 1a', 'Strip 1 · 600 wide']));
    expect(t).toContain('Settings are to the near side of the blade · kerf 3.2 · trim 5');
    // Waste is hatched and sized; the kept Offcuts are marked Keep.
    expect(pages[1]?.items.some((it) => it.kind === 'hatch')).toBe(true);
    expect(t).toEqual(expect.arrayContaining(['Waste 83.6 × 600', 'Keep W18-1-K1', '1486.8 × 400']));
    await expect(describe_(pages[1] as Page)).toMatchFileSnapshot('golden/cut-sheet-saw-W18-1.txt');
  });

  it('saw page of a Locked Board with a kept Offcut cut up: Keep ids, Discarded, and its own saw entries', async () => {
    const reused: Plan = {
      ...handPlan,
      sheets: handPlan.sheets.map((s, i) => (i === 0 ? { ...s, boards: [offcutBoard()] } : s)),
    };
    const page = cutSheet(reused, job)[1];
    const t = texts(page);
    expect(t).toEqual(expect.arrayContaining(['W18-1-C', 'Keep W18-1-K3', 'K1.1', 'K1.1a']));
    expect(t).toContain('From kept Offcut W18-1-K1 (1486.8 × 400)');
    expect(t).toContain('Left end of W18-1-K1');
    expect(t).toContain('Discarded W18-1-K2 · 2790 × 1053.6');
    expect(t).not.toContain('Keep W18-1-K1');
    await expect(describe_(page as Page)).toMatchFileSnapshot('golden/cut-sheet-saw-W18-1-offcut.txt');
  });

  it('renders to one SVG per page and to a PDF with the same page count', async () => {
    const svgs = pages.map(pageToSvg);
    expect(svgs).toHaveLength(pages.length);
    for (const svg of svgs) expect(svg.match(/<svg/g)).toHaveLength(1);

    const doc = await PDFDocument.load(await pagesToPdf(pages, { title: 'Cut sheet' }));
    expect(doc.getPageCount()).toBe(pages.length);
  });
});
