// Side A pages: one per Blank in Run order. A header naming the Blank's DXF file, the Blank drawing
// (top view, origin front-left), the Part table with Step ticks, the Blank's Manual ops and a
// "Side A done" box.
import type { Model, PartEdge, Point } from '../model.ts';
import { blankLocked } from '../plan-queries.ts';
import type { Blank, PartPrint, Placement, Plan, SheetPlan, SideAPrint } from '../planner/index.ts';
import { steps } from '../progress.ts';
import { arrow, circle, flipMark, opItems } from './drawing.ts';
import { mmText, sizeText } from './format.ts';
import { CONTENT_WIDTH, FONT, Flow, GREY, MARGIN, SHADE, WHITE, fitSize, table, text, tickBox, type Cell } from './layout.ts';
import { BLACK, type Item, type Page } from './page.ts';
import { textWidth } from './text.ts';
import {
  DASH,
  STEP_COLUMNS,
  bandedEdges,
  clampOf,
  edgebandName,
  finishedSize,
  plural,
  sectionNumber,
  stepColumns,
  workHeader,
  type CutSheetJob,
} from './work.ts';

/** A Blank with more Parts than this gets a smaller drawing, leaving room for the table. */
const FULL_DRAWING_PARTS = 5;
const DRAWING_MAX_WIDTH = CONTENT_WIDTH - 24;
const DRAWING_MAX_HEIGHT = 95;
const SMALL_DRAWING = 0.7;

export function sideAPages(plan: Plan, job: CutSheetJob): Page[] {
  const number = sectionNumber(plan, job.model, 'sideA');
  return plan.sheets.flatMap((sheet) =>
    sheet.boards.flatMap((board) =>
      board.blanks
        .filter((blank) => !job.only || job.only.blanks.includes(blank.id))
        .flatMap((blank) => blankPages(plan, job, sheet, blank, number)),
    ),
  );
}

/**
 * What a Blank's Side A page shows, from the model and Plan as they are now: the Sheet name, and per `#n`
 * the Part's name, sizes, banding, grain, Side B file, Manual ops and Steps.
 */
export function sideAPrint(plan: Plan, model: Model, sheet: SheetPlan, blank: Blank): SideAPrint {
  const parts: Record<string, PartPrint> = {};
  for (const pl of blank.parts) {
    const part = model.parts.find((p) => p.id === pl.partId);
    const sideB = plan.sideB.find((f) => f.partIds.includes(pl.partId))?.id;
    parts[String(pl.n)] = {
      name: part?.displayName ?? pl.partId,
      cutLength: part?.cutLength ?? pl.cutLength,
      cutWidth: part?.cutWidth ?? pl.cutWidth,
      ...(part ? { finished: finishedSize(model, part) } : {}),
      bands: part ? bandedEdges(part).map(({ edge, band }) => ({ edge, name: edgebandName(model, band) })) : [],
      grainLength: part?.grain === 'length',
      ...(sideB === undefined ? {} : { sideB }),
      manualOps: plan.manualOps.filter((m) => m.partId === pl.partId).map((m) => m.text),
      steps: steps({ model, plan }, pl.partId),
    };
  }
  return { sheetName: model.sheets.find((s) => s.id === sheet.sheetId)?.name ?? sheet.code, parts };
}

/**
 * Freezes the Side A page of every Locked Blank (a Part on it ticked Cut, or a Remake) that isn't frozen
 * yet, from the model and Plan the page was printed from (PRD 11.8). Call it before a re-import or a
 * regenerate changes what the page would show. The same Plan when there is nothing to freeze.
 */
export function freezeLockedPages(plan: Plan, model: Model, isCut: (partId: string) => boolean): Plan {
  let changed = false;
  const sheets = plan.sheets.map((sheet) => ({
    ...sheet,
    boards: sheet.boards.map((board) => ({
      ...board,
      blanks: board.blanks.map((blank) => {
        if (blank.sideA || !blankLocked(blank, isCut)) return blank;
        changed = true;
        return { ...blank, sideA: sideAPrint(plan, model, sheet, blank) };
      }),
    })),
  }));
  return changed ? { ...plan, sheets } : plan;
}

function blankPages(plan: Plan, job: CutSheetJob, sheet: SheetPlan, blank: Blank, number: string): Page[] {
  const print = blank.sideA ?? sideAPrint(plan, job.model, sheet, blank);
  const sheetName = print.sheetName;
  const title = `${number} · CNC Side A · ${blank.id}`;
  const topOps = blank.parts.reduce((n, p) => n + p.ops.length, 0);
  const sub = [
    sheetName,
    `Blank ${sizeText(blank.length, blank.width)}`,
    `file ${blank.id}.side-a.dxf`,
    plural(blank.parts.length, 'Part'),
    plural(topOps, 'top op'),
  ].join(' · ');
  const flow = new Flow((page, continued) => workHeader(page, job, continued ? `${title} (continued)` : title, sub));
  const of = (pl: Placement): PartPrint =>
    print.parts[String(pl.n)] ?? { name: pl.partId, cutLength: pl.cutLength, cutWidth: pl.cutWidth, bands: [], grainLength: false, manualOps: [], steps: [] };

  flow.y += 2;
  flow.add(...blankDrawing(plan, blank, of, flow.y));
  flow.y += drawingHeight(blank) + 9;
  flow.add(...key(flow.y));
  flow.y += 1;

  table(
    flow,
    MARGIN,
    [
      { header: '#', width: 7 },
      { header: 'Part', width: 28 },
      { header: 'Finished', width: 19, align: 'end' },
      { header: 'Cut size', width: 19, align: 'end' },
      { header: 'Banding', width: 24 },
      { header: 'Grain', width: 13 },
      { header: 'Side B', width: 11, align: 'middle' },
      { header: 'Manual ops', width: 17 },
      ...stepColumns(12),
    ],
    blank.parts.map((pl): Cell[] => {
      const part = of(pl);
      const ops = part.manualOps.length;
      return [
        { text: `#${String(pl.n)}`, bold: true },
        { text: part.name, bold: true, ...(pl.narrow ? { sub: 'narrow: check tabs' } : {}) },
        part.finished ? sizeText(part.finished.length, part.finished.width) : '',
        { text: sizeText(part.cutLength, part.cutWidth), bold: true },
        part.bands.length === 0
          ? DASH
          : { text: part.bands.map((b) => b.edge).join(' '), sub: [...new Set(part.bands.map((b) => b.name))].join(', ') },
        part.grainLength ? 'length' : DASH,
        part.sideB === undefined ? DASH : { text: part.sideB, bold: true, pill: true },
        ops === 0 ? DASH : { text: plural(ops, 'op'), sub: 'listed below' },
        ...STEP_COLUMNS.map((c): Cell => (part.steps.includes(c.step) ? { tick: true } : DASH)),
      ];
    }),
  );

  const manual = blank.parts.flatMap((pl) => of(pl).manualOps.map((text) => `#${String(pl.n)} ${of(pl).name}: ${text}`));
  if (manual.length > 0) {
    flow.y += 2;
    flow.paragraph('Manual ops on this Blank, by hand', { bold: true, size: FONT.small });
    for (const m of manual) flow.paragraph(m, { size: FONT.small });
  }

  flow.ensure(14);
  flow.y += 4;
  flow.add(
    { kind: 'box', x: MARGIN, y: flow.y, width: 96, height: 8, stroke: BLACK, lineWidth: 0.4 },
    tickBox(MARGIN + 2.5, flow.y + 5.7, 4),
    text(MARGIN + 8.5, flow.y + 5.4, 'Side A done', FONT.body, { bold: true }),
    text(MARGIN + 8.5 + textWidth('Side A done ', FONT.body, true), flow.y + 5.4, `ticks Cut on all ${plural(blank.parts.length, 'Part')}`, FONT.small, {
      colour: GREY,
    }),
  );
  flow.y += 8;
  return flow.pages;
}

function drawingScale(blank: Blank): number {
  const shrink = blank.parts.length > FULL_DRAWING_PARTS ? SMALL_DRAWING : 1;
  return Math.min((DRAWING_MAX_WIDTH * shrink) / blank.length, (DRAWING_MAX_HEIGHT * shrink) / blank.width);
}

const drawingHeight = (blank: Blank) => blank.width * drawingScale(blank);

/** Where a Part's footprint is on the Blank, and a Part point mapped onto the Blank. */
function footprint(pl: Placement): { length: number; width: number; toBlank: (p: Point) => Point } {
  return pl.rotated
    ? { length: pl.cutWidth, width: pl.cutLength, toBlank: (p) => ({ x: pl.x + pl.cutWidth - p.y, y: pl.y + p.x }) }
    : { length: pl.cutLength, width: pl.cutWidth, toBlank: (p) => ({ x: pl.x + p.x, y: pl.y + p.y }) };
}

/** The Blank seen from the top, front edge at the bottom, centred under the header from `top`. */
function blankDrawing(plan: Plan, blank: Blank, of: (pl: Placement) => PartPrint, top: number): Item[] {
  const s = drawingScale(blank);
  const w = blank.length * s;
  const h = blank.width * s;
  const left = MARGIN + (CONTENT_WIDTH - w) / 2;
  const X = (x: number) => left + x * s;
  const Y = (y: number) => top + h - y * s;
  const rect = (x: number, y: number, length: number, width: number) => ({ x: X(x), y: Y(y + width), width: length * s, height: width * s });
  const items: Item[] = [];

  items.push({ kind: 'box', ...rect(0, 0, blank.length, blank.width), stroke: BLACK, lineWidth: 0.4 });
  const clamp = clampOf(plan, blank);
  items.push({
    kind: 'box',
    ...rect(clamp, clamp, blank.length - 2 * clamp, blank.width - 2 * clamp),
    stroke: GREY,
    lineWidth: 0.2,
    dash: [1.5, 1],
  });

  for (const pl of blank.parts) {
    const part = of(pl);
    const fp = footprint(pl);
    const r = rect(pl.x, pl.y, fp.length, fp.width);
    const flip = part.sideB !== undefined;
    const toPage = (p: Point): [number, number] => {
      const b = fp.toBlank(p);
      return [X(b.x), Y(b.y)];
    };
    items.push({ kind: 'box', ...r, fill: flip ? SHADE : WHITE, stroke: BLACK, lineWidth: 0.3, ...(pl.narrow ? { dash: [1, 0.6] } : {}) });
    for (const op of pl.ops) items.push(...opItems(op, toPage, s, pl.cutLength, pl.cutWidth));
    for (const { edge } of part.bands) items.push(bandLine(edge, pl, toPage, r));
    if (part.grainLength && Math.min(r.width, r.height) > 5) {
      const along = Math.min(8, (pl.rotated ? r.height : r.width) - 4);
      const x0 = r.x + 2;
      const y0 = r.y + r.height - 2;
      items.push(...(pl.rotated ? arrow(x0, y0, x0, y0 - along) : arrow(x0, y0, x0 + along, y0)));
    }
    items.push(...numberLabel(r, `#${String(pl.n)}`));
    if (flip && r.width > 7 && r.height > 7) items.push(...flipMark(r.x + r.width - 2.2, r.y + 2.2, 1.2));
  }

  const below = top + h + 3.6;
  items.push(
    { kind: 'polygon', points: [[left, top + h], [left - 1.6, below - 0.6], [left + 0.6, below - 0.2]], fill: BLACK },
    text(left - 2, below + 1.2, '0,0 front-left', FONT.small, { align: 'end' }),
    text(left + w / 2, below + 1.2, `X = Board length · ${mmText(blank.length)}`, FONT.small, { align: 'middle' }),
    text(left + w + 3.6, top + h / 2, `Y · ${mmText(blank.width)}`, FONT.small, { align: 'middle', vertical: true }),
  );
  return items;
}

/** A banded edge: a thick line just inside the Part's outline. */
function bandLine(edge: PartEdge, pl: Placement, toPage: (p: Point) => [number, number], r: { x: number; y: number; width: number; height: number }): Item {
  const L = pl.cutLength;
  const W = pl.cutWidth;
  const ends: Record<PartEdge, [Point, Point]> = {
    x0: [{ x: 0, y: 0 }, { x: 0, y: W }],
    xL: [{ x: L, y: 0 }, { x: L, y: W }],
    y0: [{ x: 0, y: 0 }, { x: L, y: 0 }],
    yW: [{ x: 0, y: W }, { x: L, y: W }],
  };
  const [a, b] = ends[edge];
  let [x1, y1] = toPage(a);
  let [x2, y2] = toPage(b);
  const inset = 0.45;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  if (Math.abs(x1 - x2) < 1e-6) {
    const d = x1 < cx ? inset : -inset;
    x1 += d;
    x2 += d;
  } else {
    const d = y1 < cy ? inset : -inset;
    y1 += d;
    y2 += d;
  }
  return { kind: 'line', x1, y1, x2, y2, lineWidth: 0.9 };
}

/** `#n` in a white box at the middle of a footprint. */
function numberLabel(r: { x: number; y: number; width: number; height: number }, label: string): Item[] {
  const size = fitSize(label, Math.max(r.width - 1.5, 1), Math.min(3.4, r.height * 0.6), 1.2, true);
  const w = textWidth(label, size, true) + 1.2;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return [
    { kind: 'box', x: cx - w / 2, y: cy - size * 0.6, width: w, height: size * 1.2, fill: WHITE },
    text(cx, cy + size * 0.35, label, size, { bold: true, align: 'middle' }),
  ];
}

/** The key line under the drawing, at baseline `y`. */
function key(y: number): Item[] {
  const items: Item[] = [];
  let x = MARGIN;
  const label = (s: string) => {
    items.push(text(x, y, s, FONT.small, { colour: GREY }));
    x += textWidth(s, FONT.small) + 4;
  };
  items.push({ kind: 'box', x, y: y - 2.2, width: 3.5, height: 2.6, fill: SHADE, stroke: BLACK, lineWidth: 0.2 });
  items.push(...flipMark(x + 5.2, y - 0.9, 1));
  x += 7.2;
  label('Flip Part (Side B)');
  items.push({ kind: 'line', x1: x, y1: y - 0.9, x2: x + 4, y2: y - 0.9, lineWidth: 0.9 });
  x += 5;
  label('banded edge');
  items.push(circle(x + 1, y - 0.9, 1, { fill: BLACK }));
  x += 3;
  label('through hole');
  items.push(circle(x + 1, y - 0.9, 1, { fill: WHITE, stroke: BLACK, lineWidth: 0.15 }));
  x += 3;
  label('blind hole');
  items.push({ kind: 'box', x, y: y - 2.2, width: 4, height: 2.6, stroke: GREY, lineWidth: 0.2, dash: [1.5, 1] });
  x += 5;
  label('clamp margin');
  items.push(...arrow(x, y - 0.9, x + 4.5, y - 0.9));
  x += 5.5;
  label('grain');
  return items;
}
