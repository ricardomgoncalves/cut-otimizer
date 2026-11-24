import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pageToSvg, type Page, type QrItem } from '../src/core/documents/index.ts';
import { LABEL_QR, labels, sizeLadder, stickerSpot, type LabelsJob } from '../src/core/documents/labels.ts';
import type { CncOp, Model, Part } from '../src/core/model.ts';
import { scanPayload } from '../src/core/progress.ts';
import { pagesToPdf } from '../src/shell/pdf.ts';
import { handModel, handPlan, mm } from './cut-sheet-plan.ts';
import { pageText, texts } from './page-text.ts';
import { decodeModules } from './qr-decode.ts';

function bare(cutLength: number, cutWidth: number, ops: { top?: CncOp[]; bottom?: CncOp[] } = {}): Part {
  return {
    id: 'p',
    name: 'p',
    partName: 'P',
    displayName: 'B1 · P',
    ownerId: 'c1',
    sheetId: 's1',
    thickness: mm(18),
    cutLength: mm(cutLength),
    cutWidth: mm(cutWidth),
    grain: 'none',
    top: ops.top ?? [],
    bottom: ops.bottom ?? [],
    manualOps: [],
    edges: {},
  };
}

const drill = (x: number, y: number, d: number, depth: number | 'through'): CncOp => ({
  kind: 'drill',
  at: { x: mm(x), y: mm(y) },
  diameter: mm(d),
  depth: depth === 'through' ? 'through' : mm(depth),
});

/** The spot in mm, rounded to 0.01. */
function spotMm(part: Part) {
  const s = stickerSpot(part);
  if (!s) return null;
  const r = (v: number) => Math.round(v / 10) / 100;
  return { x: r(s.x), y: r(s.y), length: r(s.length), width: r(s.width), rotated: s.rotated };
}

describe('stickerSpot: where the label goes on the bottom face', () => {
  it('is centred on a Part with nothing on its bottom face', () => {
    // (600 − 99.1) / 2 = 250.45, (400 − 38.1) / 2 = 180.95.
    expect(spotMm(bare(600, 400))).toEqual({ x: 250.45, y: 180.95, length: 99.1, width: 38.1, rotated: false });
  });

  it('ignores blind top ops: they are on the other face', () => {
    expect(spotMm(bare(600, 400, { top: [drill(300, 200, 10, 12)] }))?.y).toBe(180.95);
  });

  it('moves the least distance off a bottom op, keeping 3 mm clear of it', () => {
    // Ø10 at (300, 205) blocks y 197..213 (with 3 mm clearance): below it the spot starts at 197 − 38.1 = 158.9
    // (22.05 off centre); above it at 213 (32.05 off); sideways would be 57.55 off.
    expect(spotMm(bare(600, 400, { bottom: [drill(300, 205, 10, 13)] }))).toEqual({
      x: 250.45,
      y: 158.9,
      length: 99.1,
      width: 38.1,
      rotated: false,
    });
  });

  it('avoids through holes (they show on the bottom face) and bottom grooves and pockets', () => {
    const groove: CncOp = { kind: 'groove', from: { x: 0, y: mm(170) }, to: { x: mm(600), y: mm(170) }, width: mm(8), depth: mm(8) };
    const pocket: CncOp = { kind: 'pocket', centre: { x: mm(300), y: mm(250) }, length: mm(40), width: mm(20), depth: mm(5) };
    // The groove blocks y 163..177 and the pocket 277..323 × 237..263 (3 mm clearance included).
    const s = spotMm(bare(600, 400, { top: [drill(250, 200, 5, 'through')], bottom: [groove, pocket] }));

    // The through hole Ø5 at (250, 200) blocks 244.5..255.5 × 194.5..205.5, so the centred spot is blocked.
    expect(s).not.toBeNull();
    const spot = s ?? { x: 0, y: 0, length: 0, width: 0 };
    const clear = (x0: number, y0: number, x1: number, y1: number) =>
      spot.x >= x1 || spot.x + spot.length <= x0 || spot.y >= y1 || spot.y + spot.width <= y0;
    expect(clear(244.5, 194.5, 255.5, 205.5)).toBe(true);
    expect(clear(0, 163, 600, 177)).toBe(true);
    expect(clear(277, 237, 323, 263)).toBe(true);
    // Nearest to the middle of all clear spots: just right of the hole (5.05 off), still in the 177..237 band.
    expect(spot).toMatchObject({ x: 255.5, y: 180.95 });
  });

  it('stays 15 mm from every edge and turns the sticker when only that fits', () => {
    // 100 long: 100 − 30 = 70 < 99.1, so the sticker can't lie along X. Turned (38.1 along X, 99.1 along Y) it
    // fits the 270 of width left: centred at x (100 − 38.1) / 2, y (300 − 99.1) / 2.
    expect(spotMm(bare(100, 300))).toEqual({ x: 30.95, y: 100.45, length: 38.1, width: 99.1, rotated: true });
  });

  it('is null when no clear spot fits (the label then says so)', () => {
    expect(stickerSpot(bare(100, 60))).toBeNull();
    // Room for the sticker, but ops everywhere.
    const holes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => drill(20 + i * 20, 50, 5, 13));
    expect(stickerSpot(bare(250, 100, { bottom: holes }))).toBeNull();
  });
});

const job: LabelsJob = { name: 'Kitchen run', shortId: '7F3A', model: handModel };
const qrs = (page: Page | undefined) => (page?.items ?? []).filter((it): it is QrItem => it.kind === 'qr');

describe('labels to reprint after a regenerate', () => {
  it('prints only the selected Parts, in label order, under its own title', () => {
    const pages = labels(handPlan, job, { partIds: ['g1/toeKick', 'c1/shelf'], title: 'Labels to reprint' });
    expect(qrs(pages[0]).map((q) => decodeModules(q.modules))).toEqual(
      ['c1/shelf', 'g1/toeKick'].map((id) => scanPayload('7F3A', id)),
    );
    expect(texts(pages[0])).toContain('Labels to reprint · Kitchen run · Job 7F3A · sheet 1 of 1');
  });
});

describe('labels: L7163 sheets, one label per Part in Run order', () => {
  const pages = labels(handPlan, job);
  const page = pages[0];

  it('puts the five Parts on one sheet: Saw Parts first, then Blanks by #n', () => {
    expect(pages).toHaveLength(1);
    expect(page).toMatchObject({ width: 210, height: 297 });
    // Decoded from the page model, the QR codes read <short id>:<Part id>, in Run order.
    expect(qrs(page).map((q) => decodeModules(q.modules))).toEqual(
      ['c1/back', 'c1/leftSide', 'c1/door', 'c1/shelf', 'g1/toeKick'].map((id) => scanPayload('7F3A', id)),
    );
  });

  it('draws the QR 14 mm square with its 2-module quiet zone, top right of the label', () => {
    const first = qrs(page)[0];
    const n = first?.modules.length ?? 0;
    const module = LABEL_QR.size / (n + 2 * LABEL_QR.quiet);
    expect(LABEL_QR).toEqual({ size: 14, ecc: 'M', quiet: 2 });
    expect(n).toBe(21);
    // Label 1 at (4.65, 15.15), 99.1 wide, 2.5 inside its right edge, 1.4 below its top.
    expect(first?.x).toBeCloseTo(4.65 + 99.1 - 2.5 - 14 + 2 * module, 6);
    expect(first?.y).toBeCloseTo(15.15 + 1.4 + 2 * module, 6);
    expect(first?.size).toBeCloseTo(n * module, 6);
    // Label 2 is the next column, 99.1 + 2.5 to the right: its code (maybe more modules) fills the same 14 mm.
    const second = qrs(page)[1];
    const n2 = second?.modules.length ?? 0;
    const outerLeft2 = (second?.x ?? 0) - (LABEL_QR.quiet * LABEL_QR.size) / (n2 + 2 * LABEL_QR.quiet);
    expect(outerLeft2 - (4.65 + 99.1 - 2.5 - 14)).toBeCloseTo(101.6, 6);
  });

  it('says what the Part is, where it is cut and what it needs', () => {
    const t = texts(page);
    expect(t).toEqual(
      expect.arrayContaining([
        // The door: Owner label, Cabinet name, Part name, finished size (cut + 1 mm band on each edge).
        'B1',
        'Base 1 door',
        '302 × 202 × 18',
        'W18-1-A #2',
        // Pills and the Manual op spelled out.
        'SIDE B 7F3A-B1',
        '1 MANUAL',
        'Drill Ø8 × 30 deep on x0 at y 100, z 9',
        // The Saw Part.
        'SAW',
        'Saw · W18 Board 1',
        // Banded edges named, the front marked, Edgeband names under the drawing.
        'yW',
        'y0 · front',
        'White ABS 1 × 23',
        'no banding',
        // Step ticks.
        'Cut',
        'Side B',
        'Banded',
        'Manual ops',
      ]),
    );
  });

  it('matches the golden page', async () => {
    await expect(pageText(page as Page)).toMatchFileSnapshot('golden/labels-sheet-1.txt');
  });

  it('notes when no sticker spot fits', () => {
    const narrow: Model = {
      ...handModel,
      parts: handModel.parts.map((p) => (p.id === 'g1/toeKick' ? { ...p, cutWidth: mm(60) } : p)),
    };
    const t = texts(labels(handPlan, { ...job, model: narrow })[0]);
    expect(t.filter((s) => s.startsWith('No clear sticker spot'))).toHaveLength(1);
    expect(texts(page).some((s) => s.startsWith('No clear sticker spot'))).toBe(false);
  });

  it('cuts long Owner labels and Part names short with …', () => {
    const long: Model = {
      ...handModel,
      owners: handModel.owners.map((o) => (o.id === 'c1' ? { ...o, label: 'Tall pantry cabinet left of the fridge B12' } : o)),
      parts: handModel.parts.map((p) =>
        p.id === 'c1/door' ? { ...p, partName: 'Section 2.1 · Drawer front with a very long name indeed' } : p,
      ),
    };
    const t = texts(labels(handPlan, { ...job, model: long })[0]);
    expect(t.filter((s) => s.startsWith('Tall pantry') && s.endsWith('…')).length).toBeGreaterThan(0);
    expect(t.filter((s) => s.startsWith('Section 2.1') && s.endsWith('…'))).toHaveLength(1);
  });

  it('starts a new sheet after 14 labels', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...handModel.parts[2] as Part, id: `c1/x${String(i)}` }));
    const blank = handPlan.sheets[0]?.boards[0]?.blanks[0];
    if (!blank) throw new Error('no Blank');
    const plan = {
      ...handPlan,
      sheets: [
        {
          ...(handPlan.sheets[0] as (typeof handPlan.sheets)[number]),
          sawParts: [],
          boards: [
            {
              ...(handPlan.sheets[0]?.boards[0] as NonNullable<(typeof handPlan.sheets)[number]['boards'][number]>),
              sawParts: [],
              blanks: [{ ...blank, parts: many.map((p, i) => ({ ...(blank.parts[0] as (typeof blank.parts)[number]), n: i + 1, partId: p.id })) }],
            },
          ],
        },
      ],
    };
    const out = labels(plan, { ...job, model: { ...handModel, parts: [...handModel.parts, ...many] } });
    expect(out).toHaveLength(2);
    expect(qrs(out[0])).toHaveLength(14);
    expect(qrs(out[1])).toHaveLength(1);
    expect(texts(out[1])).toContain('Labels · Kitchen run · Job 7F3A · sheet 2 of 2');
  });

  it('renders to SVG and to a PDF', async () => {
    expect(pageToSvg(page as Page)).toContain('class="qr"');
    const doc = await PDFDocument.load(await pagesToPdf(pages, { title: 'Labels' }));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('sizeLadder: the print-and-scan test page', () => {
  const page = sizeLadder(job);

  it('has QR codes from 8 to 22 mm for a short and a UUID-length id, all readable', () => {
    const codes = qrs(page);
    const short = scanPayload('7F3A', 'p017');
    const uuid = scanPayload('7F3A', '3f2a9c1e-7b4d-4e0a-9c2b-5d8e1f6a7b30');
    const decoded = codes.map((q) => decodeModules(q.modules));
    expect(decoded.filter((d) => d === short).length).toBeGreaterThanOrEqual(7 + 4);
    expect(decoded.filter((d) => d === uuid)).toHaveLength(7);
    const t = texts(page);
    for (const size of [8, 10, 12, 15, 17, 20, 22]) expect(t).toContain(`${String(size)} mm`);
  });

  it('has quiet zones of 0, 1, 2 and 4 modules, text from 5 to 18 pt, line weights, and cam/gun boxes', () => {
    const t = texts(page);
    for (const q of [0, 1, 2, 4]) expect(t).toContain(`${String(q)} modules`);
    for (const pt of [5, 6, 7, 8, 10, 14, 18]) expect(t.some((s) => s.startsWith(`${String(pt)} pt · `))).toBe(true);
    for (const w of ['0.6', '0.8', '1.1', '1.5']) expect(t).toContain(`${w} mm`);
    expect(t.filter((s) => s === 'cam')).toHaveLength(7 * 2 + 4);
    expect(t.filter((s) => s === 'gun')).toHaveLength(7 * 2 + 4);
  });
});
