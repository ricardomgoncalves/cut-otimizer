// Owner summary: two Owners a page, Cabinets first and then Generated Items (export order), every Part
// with its location and Step ticks. A Cabinet is ready to assemble when every box is ticked.
import type { Owner } from '../model.ts';
import type { Plan } from '../planner/index.ts';
import { FONT, Flow, GREY, MARGIN, table, text, type Cell } from './layout.ts';
import type { Page } from './page.ts';
import {
  bandingCell,
  cutText,
  finishedText,
  partLocations,
  partRunOrder,
  plural,
  sectionNumber,
  sideBCell,
  stepCells,
  stepColumns,
  workHeader,
  type CutSheetJob,
} from './work.ts';

export const OWNERS_PER_PAGE = 2;

export function ownerPages(plan: Plan, job: CutSheetJob): Page[] {
  const model = job.model;
  const where = partLocations(plan);
  const run = new Map(partRunOrder(plan).map((id, i) => [id, i]));
  const owners = [
    ...model.owners.filter((o) => o.kind === 'cabinet'),
    ...model.owners.filter((o) => o.kind === 'generatedItem'),
  ].flatMap((owner) => {
    // Parts in Run order; a Part on no Board or Blank (not planned) goes last, in export order.
    const parts = model.parts
      .filter((p) => p.ownerId === owner.id)
      .sort((a, b) => (run.get(a.id) ?? Infinity) - (run.get(b.id) ?? Infinity));
    return parts.length === 0 ? [] : [{ owner, parts }];
  });
  if (owners.length === 0) return [];

  const title = `${sectionNumber(plan, model, 'owners')} · Owner summary`;
  const sub = 'Where every Part is and what is left to do. A Cabinet is ready to assemble when every box is ticked.';
  const flow = new Flow((page, continued) => workHeader(page, job, continued ? `${title} (continued)` : title, sub));
  owners.forEach(({ owner, parts }, i) => {
    if (i > 0 && i % OWNERS_PER_PAGE === 0) flow.newPage(false);
    flow.ensure(20);
    flow.y += 8;
    flow.add(text(MARGIN, flow.y, `${ownerTitle(owner)} · ${plural(parts.length, 'Part')}`, FONT.h3, { bold: true }));
    flow.y += 1;
    table(
      flow,
      MARGIN,
      [
        { header: 'Where', width: 24 },
        { header: 'Part', width: 40 },
        { header: 'Finished', width: 20, align: 'end' },
        { header: 'Cut size', width: 20, align: 'end' },
        { header: 'Banding', width: 23 },
        { header: 'Side B', width: 11, align: 'middle' },
        ...stepColumns(12),
      ],
      parts.map((part): Cell[] => [
        { text: where.get(part.id) ?? '', bold: true },
        { text: part.displayName, bold: true },
        finishedText(model, part),
        cutText(part),
        bandingCell(model, part),
        sideBCell(plan, part.id),
        ...stepCells(plan, model, part.id),
      ]),
    );
  });
  flow.paragraph('Paper ticks are not synced: the app is the source of truth.', { size: FONT.small, colour: GREY });
  return flow.pages;
}

const ownerTitle = (owner: Owner) => (owner.cabinetName ? `${owner.label} · ${owner.cabinetName}` : owner.label);
