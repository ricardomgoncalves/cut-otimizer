// The Side B batch: one card per Side B file, two side by side. Each card has the bottom view against
// the Fence corner (edge names on the fences, the far edges to clamp), the fence-height note and the
// Flip Parts that run the file, with their locations and a Side B tick.
import { sideBFileName } from '../dxf/index.ts';
import type { Point } from '../model.ts';
import { sideBPoint, type Plan, type SideBFile } from '../planner/index.ts';
import { opItems } from './drawing.ts';
import { mmText, sizeText } from './format.ts';
import { CONTENT_WIDTH, FONT, Flow, GREY, MARGIN, SHADE, table, text, type Cell } from './layout.ts';
import { BLACK, type Item, type Page } from './page.ts';
import { partLocations, plural, sectionNumber, tiledNote, workHeader, type CutSheetJob } from './work.ts';

const GAP = 6;
const CARD_WIDTH = (CONTENT_WIDTH - GAP) / 2;
const DRAWING_LEFT = 8;
const DRAWING_MAX_WIDTH = CARD_WIDTH - DRAWING_LEFT - 6;
const DRAWING_MAX_HEIGHT = 38;
/** From the card's top to the top of the drawing. */
const DRAWING_TOP = 18;
/** The extra line a tiled Flip Part's card gets for its note. */
const TILED_LINE = 3.6;
const ROW = 4.8;

export function sideBPages(plan: Plan, job: CutSheetJob): Page[] {
  const files = plan.sideB.filter((f) => !job.only || job.only.sideB.includes(f.id));
  if (files.length === 0) return [];
  const title = `${sectionNumber(plan, job.model, 'sideB')} · CNC Side B batch`;
  const sub = 'After every Side A run, before edge banding. Zero the machine on the Fence corner once.';
  const flow = new Flow((page, continued) => workHeader(page, job, continued ? `${title} (continued)` : title, sub));
  const where = partLocations(plan);

  for (let i = 0; i < files.length; i += 2) {
    const row = files.slice(i, i + 2);
    const height = Math.max(...row.map((f) => cardHeight(plan, f)));
    flow.ensure(height + 3);
    flow.y += 3;
    const top = flow.y;
    row.forEach((file, j) => {
      flow.y = top;
      card(flow, plan, job, file, MARGIN + j * (CARD_WIDTH + GAP), top, height, where);
    });
    flow.y = top + height;
  }
  return flow.pages;
}

const drawingScale = (file: SideBFile) => Math.min(DRAWING_MAX_WIDTH / file.length, DRAWING_MAX_HEIGHT / file.width);

/** A Flip Part longer than the bed, cut in Tiles (only with Allow tiling). */
const tiled = (plan: Plan, file: SideBFile) => plan.settings.allowTiling && file.length > plan.settings.bedLength;

const drawingTop = (plan: Plan, file: SideBFile) => DRAWING_TOP + (tiled(plan, file) ? TILED_LINE : 0);

function cardHeight(plan: Plan, file: SideBFile): number {
  return drawingTop(plan, file) + file.width * drawingScale(file) + 9 + (file.partIds.length + 1) * ROW + 3;
}

function card(
  flow: Flow,
  plan: Plan,
  job: CutSheetJob,
  file: SideBFile,
  x: number,
  top: number,
  height: number,
  where: Map<string, string>,
): void {
  const parts = new Map(job.model.parts.map((p) => [p.id, p]));
  const sample = parts.get(file.partIds[0] ?? '');
  const note = plan.settings.fenceHeightNote.trim();
  const items: Item[] = [
    { kind: 'box', x, y: top, width: CARD_WIDTH, height, stroke: BLACK, lineWidth: 0.4 },
    text(x + 2, top + 5, `${file.id} · ${sideBFileName(job.shortId, file)}`, FONT.body, { bold: true, max: CARD_WIDTH - 16 }),
    text(x + CARD_WIDTH - 2, top + 5, `× ${String(file.partIds.length)}`, FONT.body, { bold: true, align: 'end' }),
    text(
      x + 2,
      top + 9,
      [
        sample ? sample.partName || sample.displayName : '',
        `cut ${sizeText(file.cutLength, file.cutWidth)}`,
        plural(file.ops.length, 'op'),
        'bottom face up',
      ]
        .filter((s) => s !== '')
        .join(' · '),
      FONT.small,
      { colour: GREY, max: CARD_WIDTH - 4 },
    ),
    text(
      x + 2,
      top + 12.6,
      note !== '' ? note : `Fence lower than the ${sample ? mmText(sample.thickness) : '?'} mm stock`,
      FONT.small,
      { bold: true, max: CARD_WIDTH - 4 },
    ),
    ...(tiled(plan, file)
      ? [text(x + 2, top + 16.2, tiledNote('Part', file.length, plan.settings.bedLength), FONT.small, { bold: true, max: CARD_WIDTH - 4 })]
      : []),
  ];

  // Bottom view: the Fence corner at the bottom left, long fence along X, short fence along Y.
  const s = drawingScale(file);
  const w = file.length * s;
  const h = file.width * s;
  const left = x + DRAWING_LEFT;
  const dTop = top + drawingTop(plan, file);
  const bottom = dTop + h;
  const toPage = (p: Point): [number, number] => {
    const q = sideBPoint(file, p);
    return [left + q.x * s, bottom - q.y * s];
  };
  const off = 0.9;
  items.push({ kind: 'box', x: left, y: dTop, width: w, height: h, fill: SHADE, stroke: BLACK, lineWidth: 0.25 });
  for (const op of file.ops) items.push(...opItems(op, toPage, s, file.cutLength, file.cutWidth));
  items.push(
    // The fences, thick, outside the near edges.
    { kind: 'line', x1: left - off, y1: bottom + off, x2: left + w * 0.7, y2: bottom + off, lineWidth: 1.2 },
    { kind: 'line', x1: left - off, y1: bottom + off, x2: left - off, y2: bottom - h * 0.6, lineWidth: 1.2 },
    text(left + w * 0.35, bottom + 4.2, file.longFence, FONT.small, { bold: true, align: 'middle' }),
    text(left - 2.4, bottom - h * 0.3, file.shortFence, FONT.small, { bold: true, align: 'end' }),
    text(left + 0.6, bottom - 0.8, '0,0', FONT.small * 0.8, { colour: GREY }),
    // The clamps go on the far edges.
    { kind: 'line', x1: left, y1: dTop - off, x2: left + w + off, y2: dTop - off, lineWidth: 0.4, dash: [1, 0.8] },
    { kind: 'line', x1: left + w + off, y1: dTop - off, x2: left + w + off, y2: bottom, lineWidth: 0.4, dash: [1, 0.8] },
    text(left + w + off, dTop - 2.2, 'clamp the far edges', FONT.small, { colour: GREY, align: 'end' }),
    text(x + 2, bottom + 8, `${file.longFence} against long fence`, FONT.small),
    text(x + CARD_WIDTH / 2, bottom + 8, `${file.shortFence} against short fence`, FONT.small),
  );
  flow.add(...items);

  flow.y = bottom + 8.5;
  table(
    flow,
    x,
    [
      { header: 'Part', width: CARD_WIDTH - 40 },
      { header: 'Where', width: 26 },
      { header: 'Side B', width: 14, align: 'middle' },
    ],
    file.partIds.map((id): Cell[] => [{ text: parts.get(id)?.displayName ?? id, bold: true }, where.get(id) ?? '', { tick: true }]),
  );
}
