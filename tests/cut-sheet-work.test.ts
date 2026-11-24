// The cut sheet's work pages after the saw (ticket #31): Side A, Side B batch, Edge banding, Owner summary.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutSheet, type CutSheetJob, type Page } from '../src/core/documents/index.ts';
import { importExport } from '../src/core/import/index.ts';
import { plan, type Plan } from '../src/core/planner/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';
import { handModel, handPlan } from './cut-sheet-plan.ts';
import { pageText, texts } from './page-text.ts';

const job: CutSheetJob = {
  name: 'Kitchen run',
  shortId: '7F3A',
  generatedAt: '2026-11-24 10:30',
  model: handModel,
  skipped: [],
};

const titled = (pages: Page[], title: string) => pages.filter((p) => texts(p)[0]?.startsWith(title));

const tickBoxes = (page: Page | undefined) =>
  (page?.items ?? []).filter((it) => it.kind === 'box' && it.width === 3.2 && it.height === 3.2);

describe('cut sheet: Side A pages', () => {
  const pages = cutSheet(handPlan, job);
  const sideA = titled(pages, '2 · CNC Side A');

  it('one page per Blank in Run order, after the saw pages', () => {
    expect(sideA.map((p) => texts(p)[0])).toEqual([
      '2 · CNC Side A · W18-1-A',
      '2 · CNC Side A · W18-1-B',
      '2 · CNC Side A · O16-1-A',
    ]);
    expect(pages.indexOf(sideA[0] as Page)).toBe(3);
  });

  it('header: Sheet, Blank size, file name, Part count and top-op count', () => {
    expect(texts(sideA[0])).toContain(
      'White melamine 18 · Blank 1000 × 600 · file W18-1-A.side-a.dxf · 2 Parts · 2 top ops',
    );
  });

  it('Part table: finished and cut size, banding, Side B pill, Manual ops, ticks with a dash where a Step does not apply', () => {
    const t = texts(sideA[0]);
    // Left side: banded y0 only (1 mm) -> finished 700 × 521; no Side B, no Manual ops.
    expect(t).toEqual(expect.arrayContaining(['#1', 'B1 · Left side', '700 × 521', '700 × 520', 'y0', 'White ABS 1 × 23']));
    // Door: banded all round -> 302 × 202; Flip Part on B1; one Manual op, spelled out under the table.
    expect(t).toEqual(expect.arrayContaining(['#2', 'B1 · Door', '302 × 202', '300 × 200', 'x0 xL y0 yW', 'B1', '1 op']));
    expect(t).toContain('#2 B1 · Door: Drill Ø8 × 30 deep on x0 at y 100, z 9');
    // Ticks: Left side has Cut + Band (2 boxes, 2 dashes); Door has all four.
    expect(tickBoxes(sideA[0])).toHaveLength(2 + 4);
    expect(t.filter((s) => s === '—').length).toBeGreaterThanOrEqual(2 + 2); // + Grain and Side B/Manual dashes
    expect(t).toContain('Side A done');
  });

  it('a narrow Part on the CNC gets the "narrow: check tabs" note', () => {
    const narrowPlan = structuredClone(handPlan);
    const shelf = narrowPlan.sheets[0]?.boards[0]?.blanks[1]?.parts[0];
    if (!shelf) throw new Error('no shelf');
    shelf.narrow = true;
    const page = titled(cutSheet(narrowPlan, job), '2 · CNC Side A · W18-1-B')[0];
    expect(texts(page)).toContain('narrow: check tabs');
    expect(texts(sideA[1])).not.toContain('narrow: check tabs');
  });

  it('the drawing shrinks when a Blank holds more than 5 Parts', () => {
    const outline = (page: Page | undefined) => page?.items.find((it) => it.kind === 'box' && it.y > 26);
    const crowded = structuredClone(handPlan);
    const blank = crowded.sheets[0]?.boards[0]?.blanks[0];
    if (!blank) throw new Error('no Blank');
    const first = blank.parts[0];
    if (!first) throw new Error('no Part');
    blank.parts = [1, 2, 3, 4, 5, 6].map((n) => ({ ...first, n }));
    const small = outline(titled(cutSheet(crowded, job), '2 · CNC Side A · W18-1-A')[0]);
    const full = outline(sideA[0]);
    if (small?.kind !== 'box' || full?.kind !== 'box') throw new Error('no outline');
    expect(small.width).toBeCloseTo(full.width * 0.7, 5);
  });
});

describe('cut sheet: Side B batch', () => {
  const pages = cutSheet(handPlan, job);
  const sideB = titled(pages, '3 · CNC Side B batch');

  it('one card per Side B file: file name, fence corner edges, clamp edges, fence note, Parts with location and tick', () => {
    expect(sideB).toHaveLength(1);
    const t = texts(sideB[0]);
    expect(t).toContain('B1 · 7F3A-B1.side-b.dxf');
    expect(t).toContain('yW against long fence');
    expect(t).toContain('x0 against short fence');
    expect(t).toContain('clamp the far edges');
    expect(t).toContain('Fence lower than the 18 mm stock');
    expect(t).toEqual(expect.arrayContaining(['B1 · Door', 'W18-1-A #2']));
    expect(tickBoxes(sideB[0])).toHaveLength(1);
  });

  it('prints the fence-height note from Machine settings when there is one', () => {
    const noted = { ...handPlan, settings: { ...handPlan.settings, fenceHeightNote: 'Use the 12 mm fence strips' } };
    expect(texts(titled(cutSheet(noted, job), '3 · CNC Side B batch')[0])).toContain('Use the 12 mm fence strips');
  });

  it('is left out when the Job has no Flip Parts, and the later sections renumber', () => {
    const all = cutSheet({ ...handPlan, sideB: [] }, job);
    expect(titled(all, '3 · CNC Side B batch')).toHaveLength(0);
    expect(titled(all, '3 · Edge banding')).toHaveLength(1);
  });
});

describe('cut sheet: Edge banding', () => {
  const pages = cutSheet(handPlan, job);
  const banding = titled(pages, '4 · Edge banding');

  it('one list per Edgeband: Parts in Run order with location, edges, sizes and Step ticks', () => {
    expect(banding.map((p) => texts(p)[0])).toEqual(['4 · Edge banding · White ABS 1 × 23']);
    const t = texts(banding[0]);
    const where = t.filter((s) => /^(W18|O16)-\d/.test(s));
    expect(where).toEqual(['W18-1-A #1', 'W18-1-A #2', 'O16-1-A #1']);
    expect(t).toEqual(expect.arrayContaining(['B1 · Left side', 'B1 · Door', 'Toe Kick B1', '620 × 150', '620 × 149']));
    // Left side Cut + Band, Door all four, Toe Kick Cut + Band.
    expect(tickBoxes(banding[0])).toHaveLength(2 + 4 + 2);
  });

  it('16 rows a page', () => {
    const many = structuredClone(handModel);
    const crowded = structuredClone(handPlan);
    const blank = crowded.sheets[1]?.boards[0]?.blanks[0];
    const toeKick = blank?.parts[0];
    const part = many.parts.find((p) => p.id === 'g1/toeKick');
    if (!blank || !toeKick || !part) throw new Error('no toe kick');
    blank.parts = Array.from({ length: 20 }, (_, i) => ({ ...toeKick, n: i + 1, partId: `g1/toeKick${String(i)}` }));
    many.parts.push(...blank.parts.map((p) => ({ ...part, id: p.partId })));
    const lists = titled(cutSheet(crowded, { ...job, model: many }), '4 · Edge banding');
    expect(lists).toHaveLength(2);
    // Left side and Door, then 14 + 6 Toe Kicks.
    expect(lists.map((p) => texts(p).filter((s) => s.startsWith('O16-1-A #') || s.startsWith('W18-1-A #')).length)).toEqual([16, 6]);
    expect(texts(lists[1])[0]).toBe('4 · Edge banding · White ABS 1 × 23 (continued)');
  });
});

describe('cut sheet: Owner summary', () => {
  const pages = cutSheet(handPlan, job);
  const owners = titled(pages, '6 · Owner summary');

  it('two Owners a page, Cabinets first: every Part with its location and Step ticks', () => {
    expect(pages[pages.length - 1]).toBe(owners[0]);
    expect(owners).toHaveLength(1);
    const t = texts(owners[0]);
    expect(t.indexOf('B1 · Base 1 door · 4 Parts')).toBeGreaterThan(0);
    expect(t.indexOf('B1 · Base 1 door · 4 Parts')).toBeLessThan(t.indexOf('Toe Kick B1 · 1 Part'));
    expect(t).toEqual(
      expect.arrayContaining(['W18-1-A #1', 'W18-1-A #2', 'W18-1 saw', 'W18-1-B #1', 'O16-1-A #1', 'B1 · Back']),
    );
    // Left side 2, Door 4, Back 1, Shelf 1, Toe Kick 2.
    expect(tickBoxes(owners[0])).toHaveLength(10);
  });

  it('starts a new page every two Owners', () => {
    const more = structuredClone(handModel);
    more.owners.push({ kind: 'cabinet', id: 'c3', label: 'W1', cabinetName: 'Wall 1' });
    const shelf = more.parts.find((p) => p.id === 'c1/shelf');
    if (!shelf) throw new Error('no shelf');
    shelf.ownerId = 'c3';
    const sheet = titled(cutSheet(handPlan, { ...job, model: more }), '6 · Owner summary');
    expect(sheet.map((p) => texts(p).filter((s) => / · \d+ Parts?$/.test(s)))).toEqual([
      ['B1 · Base 1 door · 3 Parts', 'W1 · Wall 1 · 1 Part'],
      ['Toe Kick B1 · 1 Part'],
    ]);
  });
});

function plannedFixture(): { plan: Plan; job: CutSheetJob } {
  const json: unknown = JSON.parse(readFileSync(new URL('../fixtures/synthetic.parts.json', import.meta.url), 'utf8'));
  const { model } = importExport(json);
  if (!model) throw new Error('fixture did not import');
  return { plan: plan(model, DEFAULT_SETTINGS), job: { ...job, model } };
}

describe('cut sheet: every Part is placed once', () => {
  it.each([
    ['the hand-written Plan', () => ({ plan: handPlan, job })],
    ['the planned synthetic fixture', plannedFixture],
  ])('%s: on exactly one Side A page or saw page, and on exactly one Owner page', (_, make) => {
    const { plan: p, job: j } = make();
    const pages = cutSheet(p, j);
    const sideA = titled(pages, '2 · CNC Side A');
    const saw = titled(pages, '1 · Saw');
    const owners = pages.filter((page) => texts(page)[0]?.endsWith('· Owner summary'));
    expect(owners.length).toBeGreaterThan(0);

    for (const part of j.model.parts) {
      const onSideA = sideA.filter((page) => texts(page).includes(part.displayName)).length;
      const onSaw = saw.filter((page) => texts(page).some((s) => s.startsWith(`SAW · ${part.displayName} · `))).length;
      expect([part.id, onSideA + onSaw]).toEqual([part.id, 1]);
      expect([part.id, owners.filter((page) => texts(page).includes(part.displayName)).length]).toEqual([part.id, 1]);
    }
  });
});

describe('cut sheet goldens (hand-written Plan)', () => {
  const pages = cutSheet(handPlan, job);
  it.each([
    ['side-a-W18-1-A', '2 · CNC Side A · W18-1-A'],
    ['side-b', '3 · CNC Side B batch'],
    ['banding-e1', '4 · Edge banding'],
    ['owners', '6 · Owner summary'],
  ])('%s', async (name, title) => {
    await expect(pageText(titled(pages, title)[0] as Page)).toMatchFileSnapshot(`golden/cut-sheet-${name}.txt`);
  });
});
