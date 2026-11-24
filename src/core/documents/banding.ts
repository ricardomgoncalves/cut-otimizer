// Edge banding: one list per Edgeband (in order of its first Part in Run order), the Parts it goes on
// in Run order, 16 rows a page, with location, the edges, sizes and Step ticks.
import type { Plan } from '../planner/index.ts';
import { Flow, MARGIN, table, type Cell } from './layout.ts';
import type { Page } from './page.ts';
import {
  bandedEdges,
  cutText,
  edgebandName,
  finishedText,
  partLocations,
  partRunOrder,
  plural,
  sectionNumber,
  stepCells,
  stepColumns,
  workHeader,
  type CutSheetJob,
} from './work.ts';

export const BANDING_ROWS_PER_PAGE = 16;

export function bandingPages(plan: Plan, job: CutSheetJob): Page[] {
  const model = job.model;
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const where = partLocations(plan);
  const order = partRunOrder(plan).flatMap((id) => {
    const part = parts.get(id);
    return part ? [part] : [];
  });
  const bands = [...new Set(order.flatMap((p) => bandedEdges(p).map((b) => b.band)))];
  if (bands.length === 0) return [];
  const number = sectionNumber(plan, model, 'banding');

  return bands.flatMap((band) => {
    const rows = order.flatMap((part) => {
      const edges = bandedEdges(part).filter((b) => b.band === band);
      return edges.length === 0 ? [] : [{ part, edges: edges.map((e) => e.edge) }];
    });
    const edgeCount = rows.reduce((n, r) => n + r.edges.length, 0);
    const title = `${number} · Edge banding · ${edgebandName(model, band)}`;
    const sub = `Bands go on after Side B, on the edges listed. ${plural(rows.length, 'Part')}, ${plural(edgeCount, 'edge')}.`;
    const flow = new Flow((page, continued) => workHeader(page, job, continued ? `${title} (continued)` : title, sub));
    for (let i = 0; i < rows.length; i += BANDING_ROWS_PER_PAGE) {
      if (i > 0) flow.newPage(true);
      flow.y += 2;
      table(
        flow,
        MARGIN,
        [
          { header: 'Where', width: 24 },
          { header: 'Part', width: 52 },
          { header: 'Edges', width: 18 },
          { header: 'Finished', width: 22, align: 'end' },
          { header: 'Cut size', width: 22, align: 'end' },
          ...stepColumns(12),
        ],
        rows.slice(i, i + BANDING_ROWS_PER_PAGE).map(({ part, edges }): Cell[] => [
          { text: where.get(part.id) ?? '', bold: true },
          { text: part.displayName, bold: true },
          edges.join(' '),
          finishedText(model, part),
          cutText(part),
          ...stepCells(plan, model, part.id),
        ]),
      );
    }
    return flow.pages;
  });
}
