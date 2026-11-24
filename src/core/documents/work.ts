// Shared pieces of the cut sheet's pages: the work-page header, the numbered sections (the cover's
// "Order of work"), Part Run order and locations, and the cells every Part table repeats.
import type { Model, Part, PartEdge } from '../model.ts';
import type { Blank, Plan } from '../planner/index.ts';
import { steps, type Step } from '../progress.ts';
import { sizeText } from './format.ts';
import { CONTENT_WIDTH, FONT, GREY, MARGIN, text, type Cell, type Column } from './layout.ts';
import { A4, type Page } from './page.ts';

/** What the cut sheet needs besides the Plan. */
export interface CutSheetJob {
  /** The Job name. */
  name: string;
  shortId: string;
  /** Shown as given ("2026-11-24 10:30"): the shell formats it in local time. */
  generatedAt: string;
  model: Model;
  /** The export's Skipped items (the Job is incomplete when there are any). */
  skipped: { label: string; name: string; reason: string }[];
}

export const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

export function partName(job: CutSheetJob): (partId: string) => string {
  const names = new Map(job.model.parts.map((p) => [p.id, p.displayName]));
  return (id) => names.get(id) ?? id;
}

/** The page header of a work page: title, subtitle and the Job at the right. Returns where content starts. */
export function workHeader(page: Page, job: CutSheetJob, title: string, sub: string): number {
  const metaWidth = 64;
  page.items.push(
    text(MARGIN, 17, title, FONT.h2, { bold: true, max: CONTENT_WIDTH - metaWidth }),
    text(MARGIN, 22.5, sub, FONT.small, { colour: GREY, max: CONTENT_WIDTH }),
    text(A4.width - MARGIN, 15, job.name, FONT.small, { colour: GREY, align: 'end', max: metaWidth }),
    text(A4.width - MARGIN, 19, `Job ${job.shortId} · generated ${job.generatedAt}`, FONT.small, {
      colour: GREY,
      align: 'end',
      max: metaWidth,
    }),
    { kind: 'line', x1: MARGIN, y1: 25, x2: A4.width - MARGIN, y2: 25, lineWidth: 0.5 },
  );
  return 26;
}

/** A section of the cut sheet, as numbered in the cover's "Order of work". */
export type Section = 'saw' | 'sideA' | 'sideB' | 'banding' | 'manualOps' | 'owners';

/** The sections in work order; a section number is its index + 1. Side B, banding and Manual ops only when present. */
export function sections(plan: Plan, model: Model): Section[] {
  return [
    'saw',
    'sideA',
    ...(plan.sideB.length > 0 ? (['sideB'] as const) : []),
    ...(isBanded(model) ? (['banding'] as const) : []),
    ...(plan.manualOps.length > 0 ? (['manualOps'] as const) : []),
    'owners',
  ];
}

export function sectionNumber(plan: Plan, model: Model, section: Section): string {
  return String(sections(plan, model).indexOf(section) + 1);
}

export const isBanded = (model: Model) => model.parts.some((p) => bandedEdges(p).length > 0);

/** Every Part id in Run order: per Sheet and Board, the Blanks' Parts (letter, `#n`), then the Board's Saw Parts; unplaced last. */
export function partRunOrder(plan: Plan): string[] {
  return plan.sheets.flatMap((sheet) => [
    ...sheet.boards.flatMap((board) => [
      ...board.blanks.flatMap((blank) => blank.parts.map((p) => p.partId)),
      ...board.sawParts.map((p) => p.partId),
    ]),
    ...sheet.unplaced,
  ]);
}

/**
 * Where each Part is cut, as printed across pages: `W18-1-A #3` on a Blank, `W18-1 saw` for a Saw Part
 * of Board W18-1, `W18 saw, no Board` for a Saw Part too big for any Board.
 */
export function partLocations(plan: Plan): Map<string, string> {
  const where = new Map<string, string>();
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) {
      for (const blank of board.blanks) for (const p of blank.parts) where.set(p.partId, `${blank.id} #${String(p.n)}`);
      for (const p of board.sawParts) where.set(p.partId, `${sheet.code}-${String(board.number)} saw`);
    }
    for (const id of sheet.unplaced) where.set(id, `${sheet.code} saw, no Board`);
  }
  return where;
}

/** The clamp margin a Blank was nested with. */
export function clampOf(plan: Plan, blank: Blank): number {
  // A Blank kept from an earlier Plan may carry its own clamp margin (Locked Blanks, ticket #36).
  return (blank as { clampMargin?: number }).clampMargin ?? plan.settings.clampMargin;
}

const EDGES: PartEdge[] = ['x0', 'xL', 'y0', 'yW'];

/** The banded edges of a Part, in x0, xL, y0, yW order. */
export function bandedEdges(part: Part): { edge: PartEdge; band: string }[] {
  return EDGES.flatMap((edge) => {
    const band = part.edges[edge];
    return band === undefined ? [] : [{ edge, band }];
  });
}

/** The finished size: the cut size plus the Edgeband thickness on each banded edge. */
export function finishedSize(model: Model, part: Part): { length: number; width: number } {
  const t = (edge: PartEdge) => {
    const band = part.edges[edge];
    return band === undefined ? 0 : (model.edgebands.find((e) => e.id === band)?.thickness ?? 0);
  };
  return { length: part.cutLength + t('x0') + t('xL'), width: part.cutWidth + t('y0') + t('yW') };
}

export const finishedText = (model: Model, part: Part) => {
  const f = finishedSize(model, part);
  return sizeText(f.length, f.width);
};

export const cutText = (part: Part): Cell => ({ text: sizeText(part.cutLength, part.cutWidth), bold: true });

export const edgebandName = (model: Model, id: string) => model.edgebands.find((e) => e.id === id)?.name ?? id;

/** Banding: the banded edges, with the Edgeband names under them. A dash when unbanded. */
export function bandingCell(model: Model, part: Part): Cell {
  const banded = bandedEdges(part);
  if (banded.length === 0) return DASH;
  const names = [...new Set(banded.map((b) => edgebandName(model, b.band)))];
  return { text: banded.map((b) => b.edge).join(' '), sub: names.join(', ') };
}

/** A Step that doesn't apply to a Part. */
export const DASH: Cell = { text: '—', colour: GREY };

export const STEP_COLUMNS: { step: Step; header: string }[] = [
  { step: 'cut', header: 'Cut' },
  { step: 'sideB', header: 'Side B' },
  { step: 'banded', header: 'Band' },
  { step: 'manualOps', header: 'Manual' },
];

/** The Step tick columns, `width` mm each. */
export const stepColumns = (width: number): Column[] =>
  STEP_COLUMNS.map((c) => ({ header: c.header, width, align: 'middle' }));

/** A tick box per Step that applies to the Part, a dash for the others. */
export function stepCells(plan: Plan, model: Model, partId: string): Cell[] {
  const applicable = steps({ model, plan }, partId);
  return STEP_COLUMNS.map((c) => (applicable.includes(c.step) ? { tick: true } : DASH));
}

/** The Side B file of a Flip Part, as a pill; a dash for other Parts. */
export function sideBCell(plan: Plan, partId: string): Cell {
  const file = plan.sideB.find((f) => f.partIds.includes(partId));
  return file ? { text: file.id, bold: true, pill: true } : DASH;
}
