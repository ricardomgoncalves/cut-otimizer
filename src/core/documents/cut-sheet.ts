// The cut sheet ("Shop flow" PDF, PRD story 7.1): pages in the order the work happens. The cover and the
// saw pages (one per Board, Run order) are here; Side A (side-a.ts), the Side B batch (side-b-pages.ts),
// Edge banding (banding.ts) and the Owner summary (owners.ts) follow.
import { layerUsage, referenceLayers, type LayerUse } from '../dxf/index.ts';
import type { Model, PartEdge } from '../model.ts';
import type { Board, Plan, SheetPlan } from '../planner/index.ts';
import { CATEGORIES, type Category } from '../reimport.ts';
import { edgeTrimFor } from '../settings.ts';
import { mmText, sizeText } from './format.ts';
import {
  BOTTOM,
  CONTENT_WIDTH,
  FONT,
  Flow,
  GREY,
  MARGIN,
  RULE,
  SHADE,
  WHITE,
  fitSize,
  table,
  text,
  type Cell,
} from './layout.ts';
import { A4, BLACK, type Item, type Page } from './page.ts';
import { sawCuts, type SawCutRow } from './saw.ts';
import { textWidth as textWidthOf } from './text.ts';
import { bandingPages } from './banding.ts';
import { ownerPages } from './owners.ts';
import { sideAPages } from './side-a.ts';
import { sideBPages } from './side-b-pages.ts';
import { partName, plural, workHeader, type CutSheetJob } from './work.ts';

export type { CutSheetJob } from './work.ts';

/**
 * The cut sheet's pages: the cover, one saw page per Board, one Side A page per Blank (Run order), the
 * Side B batch, Edge banding per Edgeband and the Owner summary. Longer tables carry on onto extra pages.
 */
export function cutSheet(plan: Plan, job: CutSheetJob): Page[] {
  const saw = sawPages(plan, job);
  let cover = coverPages(plan, job, 2, saw.length);
  if (cover.length !== 1) cover = coverPages(plan, job, cover.length + 1, saw.length);
  const pages = [
    ...cover,
    ...saw,
    ...sideAPages(plan, job),
    ...sideBPages(plan, job),
    ...bandingPages(plan, job),
    ...ownerPages(plan, job),
  ];
  pages.forEach((page, i) => {
    const y = A4.height - 7;
    page.items.push(
      text(MARGIN, y, `${job.name} · Job ${job.shortId}`, FONT.small, { colour: GREY, max: CONTENT_WIDTH * 0.7 }),
      text(A4.width - MARGIN, y, `Page ${String(i + 1)} of ${String(pages.length)}`, FONT.small, {
        colour: GREY,
        align: 'end',
      }),
    );
  });
  return pages;
}

// --- Cover ----------------------------------------------------------------------------------------

function coverPages(plan: Plan, job: CutSheetJob, sawFrom: number, sawCount: number): Page[] {
  const generated = `Job ${job.shortId} · generated ${job.generatedAt}`;
  const flow = new Flow((page, continued) => {
    if (!continued) return MARGIN;
    page.items.push(
      text(MARGIN, 18, `Cut sheet · ${job.name} (continued)`, FONT.h2, { bold: true, max: CONTENT_WIDTH }),
      { kind: 'line', x1: MARGIN, y1: 21, x2: A4.width - MARGIN, y2: 21, lineWidth: 0.4 },
    );
    return 22;
  });
  const boards = plan.sheets.flatMap((s) => s.boards);
  const blanks = boards.flatMap((b) => b.blanks);
  const nameOf = partName(job);

  flow.y += 8;
  flow.add(text(MARGIN, flow.y, `Cut sheet · ${job.name}`, FONT.h1, { bold: true, max: CONTENT_WIDTH }));
  flow.y += 6;
  flow.add(text(MARGIN, flow.y, generated, FONT.body, { colour: GREY }));
  flow.y += 5;
  flow.add(
    text(
      MARGIN,
      flow.y,
      [
        plural(job.model.parts.length, 'Part'),
        plural(boards.length, 'Board'),
        plural(blanks.length, 'Blank'),
        plural(plan.sideB.length, 'Side B file'),
      ].join(' · '),
      FONT.body,
      { bold: true },
    ),
  );

  // Order of work.
  const banded = job.model.parts.some((p) => Object.keys(p.edges).length > 0);
  const sawPagesText = sawCount === 1 ? `page ${String(sawFrom)}` : `pages ${String(sawFrom)}–${String(sawFrom + sawCount - 1)}`;
  const steps = [
    `Saw: break each Board into Blanks and Saw Parts (${sawPagesText})`,
    `CNC Side A: one file per Blank (${plural(blanks.length, 'file')})`,
    ...(plan.sideB.length > 0 ? [`CNC Side B: Flip Parts, after Side A (${plural(plan.sideB.length, 'file')})`] : []),
    ...(banded ? ['Edge banding'] : []),
    ...(plan.manualOps.length > 0 ? ['Manual ops, by hand'] : []),
    'Check every Part off and assemble',
  ];
  flow.heading('Order of work');
  steps.forEach((s, i) => {
    flow.paragraph(`${String(i + 1)}. ${s}`);
  });

  // Before you start.
  const spares = job.spares ?? [];
  const sawIds = plan.sheets.flatMap((s) => s.sawParts);
  const unplaced = plan.sheets.flatMap((s) => s.unplaced);
  const manualParts = new Set(plan.manualOps.map((m) => m.partId));
  const notes = [
    sawIds.length === 0
      ? 'Saw Parts: none.'
      : `Saw Parts: ${String(sawIds.length)} (${sawIds.map(nameOf).join(', ')}), cut on the saw, not on the CNC.`,
    ...(unplaced.length > 0
      ? [`Too big for any Board, cut by hand from stock: ${unplaced.map(nameOf).join(', ')}.`]
      : []),
    plan.manualOps.length === 0
      ? 'Manual ops: none.'
      : `Manual ops: ${String(plan.manualOps.length)} on ${plural(manualParts.size, 'Part')}, done by hand.`,
    job.skipped.length === 0
      ? 'Skipped items: none.'
      : `Skipped items: ${job.skipped.map((s) => `${s.label} · ${s.name} (${s.reason})`).join(', ')}. This Job is incomplete.`,
    spares.length === 0
      ? 'Spares: none.'
      : `Spares: ${plural(spares.length, 'cut Part')} no longer in the export (${spares.map((s) => s.displayName).join(', ')}): set them aside. They count nowhere.`,
  ];
  flow.y += 3;
  const boxTop = flow.y;
  const boxItemsAt = flow.page.items.length;
  flow.y += 1;
  flow.paragraph('Before you start', { x: MARGIN + 2, bold: true });
  for (const note of notes) flow.paragraph(note, { x: MARGIN + 2, width: CONTENT_WIDTH - 4 });
  flow.y += 2;
  if (flow.page.items.length > boxItemsAt && flow.y > boxTop) {
    flow.page.items.splice(boxItemsAt, 0, {
      kind: 'box',
      x: MARGIN,
      y: boxTop,
      width: CONTENT_WIDTH,
      height: flow.y - boxTop,
      stroke: BLACK,
      lineWidth: 0.4,
    });
  }

  // Materials per Sheet.
  flow.heading('Materials');
  table(
    flow,
    MARGIN,
    [
      { header: 'Sheet', width: 86 },
      { header: 'Code', width: 20 },
      { header: 'Boards', width: 20, align: 'end' },
      { header: 'Blanks', width: 20, align: 'end' },
      { header: 'Saw Parts', width: 20, align: 'end' },
      { header: 'Parts', width: 20, align: 'end' },
    ],
    plan.sheets.map((s): Cell[] => {
      const sheet = job.model.sheets.find((m) => m.id === s.sheetId);
      const parts = job.model.parts.filter((p) => p.sheetId === s.sheetId).length;
      return [
        sheet ? `${sheet.name} · ${sizeText(sheet.length, sheet.width)} · grain ${sheet.grain}` : s.sheetId,
        { text: s.code, bold: true },
        { text: String(s.boards.length), bold: true },
        String(s.boards.reduce((a, b) => a + b.blanks.length, 0)),
        String(s.sawParts.length),
        String(parts),
      ];
    }),
  );

  // Machine settings and Edgebanding, side by side.
  const half = (CONTENT_WIDTH - 6) / 2;
  const settingsRows = settingsTable(plan, job);
  const bandRows = edgebandTable(job.model);
  flow.ensure(16 + 4.8 * Math.max(settingsRows.length + 1, bandRows.length));
  flow.heading('Machine settings (snapshot)');
  flow.add(text(MARGIN + half + 6, flow.y - 2, 'Edgebanding', FONT.h3, { bold: true }));
  const top = flow.y;
  table(flow, MARGIN, [{ header: 'Setting', width: half - 26 }, { header: 'mm', width: 26, align: 'end' }], settingsRows);
  flow.paragraph('Outlines need tabs or onion skin in CAM', { bold: true, size: FONT.small });
  const leftEnd = flow.y;
  flow.y = top;
  table(
    flow,
    MARGIN + half + 6,
    [
      { header: 'Edgeband', width: half - 46 },
      { header: 'Edges', width: 18, align: 'end' },
      { header: 'Length (+10%)', width: 28, align: 'end' },
    ],
    bandRows.length > 0 ? bandRows : [[{ text: 'No banded edges', colour: GREY }, '', '']],
  );
  flow.y = Math.max(leftEnd, flow.y);

  // Layer legend.
  flow.heading('Layer legend');
  table(
    flow,
    MARGIN,
    [
      { header: 'Layer', width: 52 },
      { header: 'Count', width: 18, align: 'end' },
      { header: 'Stock', width: 18, align: 'end' },
      { header: 'Suggested toolpath', width: CONTENT_WIDTH - 88 },
    ],
    [
      ...layerUsage(plan, (id) => job.model.parts.find((p) => p.id === id)?.thickness ?? 0).map((u): Cell[] => [
        { text: u.layer, bold: true },
        String(u.count),
        mmText(u.thickness),
        toolpath(u, plan.settings.bitDiameter),
      ]),
    ],
  );
  flow.paragraph(`Reference layers, never cut: ${referenceLayers(plan).join(' · ')}`, { size: FONT.small, colour: GREY });

  // Spares: cut Parts a re-import removed, to find and set aside.
  if (spares.length > 0) {
    flow.heading('Spares');
    table(
      flow,
      MARGIN,
      [
        { header: 'Spare (old name)', width: 80 },
        { header: 'Cut size', width: 40 },
        { header: 'Was cut at', width: CONTENT_WIDTH - 120 },
      ],
      spares.map((s): Cell[] => [
        { text: s.displayName, bold: true },
        `${sizeText(s.cutLength, s.cutWidth)} × ${mmText(s.thickness)}`,
        s.where ?? { text: '—', colour: GREY },
      ]),
    );
  }

  // Re-import log.
  const log = job.reimportLog ?? [];
  if (log.length > 0) {
    flow.heading('Re-import log');
    table(
      flow,
      MARGIN,
      [
        { header: 'Applied', width: 28 },
        { header: 'Exported', width: 28 },
        { header: 'File', width: 50 },
        { header: 'Parts', width: CONTENT_WIDTH - 106 },
      ],
      log.map((entry): Cell[] => [
        isoMinutes(entry.at),
        entry.exportedAt === undefined ? { text: '—', colour: GREY } : isoMinutes(entry.exportedAt),
        entry.fileName,
        countsText(entry.counts),
      ]),
    );
  }
  return flow.pages;
}

const CATEGORY_NAMES: Record<Category, string> = {
  changedCut: 'Changed (cut)',
  changedFinishing: 'Changed (finishing)',
  added: 'Added',
  removed: 'Removed',
  renamed: 'Renamed',
  same: 'Same',
};

/** `1 Changed (cut) · 2 Added · 3 Same`: the non-zero counts in diff order. */
function countsText(counts: Readonly<Record<Category, number>>): string {
  return CATEGORIES.filter((c) => counts[c] > 0)
    .map((c) => `${String(counts[c])} ${CATEGORY_NAMES[c]}`)
    .join(' · ');
}

/** An ISO time as `YYYY-MM-DD HH:MM`, as written (UTC for times the app stores). */
function isoMinutes(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function settingsTable(plan: Plan, job: CutSheetJob): Cell[][] {
  const s = plan.settings;
  const trimOverrides = plan.sheets
    .filter((sh) => s.edgeTrimBySheet[sh.sheetId] !== undefined)
    .map((sh) => `${sh.code} ${mmText(edgeTrimFor(s, sh.sheetId))}`);
  const rows: Cell[][] = [
    ['Bed', sizeText(s.bedLength, s.bedWidth)],
    ['Clamp margin (4 edges)', mmText(s.clampMargin)],
    ['Bit', `Ø${mmText(s.bitDiameter)}`],
    ['Saw kerf', mmText(s.sawKerf)],
    ['Edge trim', [mmText(s.edgeTrim), ...trimOverrides].join(' · ')],
    ['Min CNC width', mmText(s.minCncWidth)],
    ['Min Offcut size', mmText(s.minOffcutSize)],
    ['Bottom ops done by hand', s.manualBottomOpKinds.length > 0 ? s.manualBottomOpKinds.join(', ') : 'none'],
  ];
  if (s.fenceHeightNote.trim() !== '') rows.push(['Fence note', s.fenceHeightNote.trim()]);
  void job;
  return rows;
}

const EDGE_ALONG_Y: PartEdge[] = ['x0', 'xL'];

/** Per Edgeband in library order: banded edges and their total length (cut length of the edge) + 10%. */
function edgebandTable(model: Model): Cell[][] {
  const totals = new Map<string, { edges: number; length: number }>();
  for (const part of model.parts) {
    for (const [edge, band] of Object.entries(part.edges) as [PartEdge, string | undefined][]) {
      if (band === undefined) continue;
      const t = totals.get(band) ?? { edges: 0, length: 0 };
      t.edges++;
      t.length += EDGE_ALONG_Y.includes(edge) ? part.cutWidth : part.cutLength;
      totals.set(band, t);
    }
  }
  const named = model.edgebands.filter((e) => totals.has(e.id)).map((e) => ({ id: e.id, name: e.name }));
  const unknown = [...totals.keys()].filter((id) => !model.edgebands.some((e) => e.id === id)).map((id) => ({ id, name: id }));
  return [...named, ...unknown].map(({ id, name }) => {
    const t = totals.get(id) ?? { edges: 0, length: 0 };
    return [name, String(t.edges), `${((t.length * 1.1) / 1e6).toFixed(1)} m`];
  });
}

function toolpath(u: LayerUse, bit: number): string {
  switch (u.kind) {
    case 'outline':
      return 'Profile outside, through: tabs or onion skin';
    case 'drill': {
      const d = u.diameter ?? 0;
      if (d === bit) return `Plunge with the Ø${mmText(bit)} bit`;
      if (d < bit) return `Drill: needs a Ø${mmText(d)} bit (tool change)`;
      return `Helix or pocket with the Ø${mmText(bit)} bit`;
    }
    case 'groove':
      return 'Pocket (slot) to depth';
    case 'pocket':
      return 'Pocket to depth';
  }
}

// --- Saw pages ------------------------------------------------------------------------------------

const DRAWING_LEFT = MARGIN + 9;
const DRAWING_WIDTH = A4.width - MARGIN - DRAWING_LEFT;
const DRAWING_MAX_HEIGHT = 112;

function sawPages(plan: Plan, job: CutSheetJob): Page[] {
  const pages: Page[] = [];
  for (const sheet of plan.sheets) {
    for (const board of sheet.boards) pages.push(...sawBoardPages(plan, job, sheet, board));
  }
  return pages;
}

function sawBoardPages(plan: Plan, job: CutSheetJob, sheet: SheetPlan, board: Board): Page[] {
  const model = job.model.sheets.find((s) => s.id === sheet.sheetId);
  const nameOf = partName(job);
  const title = `1 · Saw · ${sheet.code} · Board ${String(board.number)} of ${String(sheet.boards.length)}`;
  const offcuts = board.offcuts.filter((o) => !o.used);
  const kept = offcuts.filter((o) => o.kept && !o.discarded).length;
  const sub = [
    model ? `${model.name} · ${sizeText(board.length, board.width)}` : sizeText(board.length, board.width),
    [plural(board.blanks.length, 'Blank'), plural(board.sawParts.length, 'Saw Part'), `${plural(offcuts.length, 'Offcut')} (${String(kept)} kept)`].join(', '),
  ].join(' · ');
  const flow = new Flow((page, continued) =>
    workHeader(page, job, continued ? `${title} (continued)` : title, sub),
  );

  flow.y += 4;
  flow.y = breakdownDrawing(flow, plan, sheet, board, nameOf, model?.grain ?? 'none');

  flow.heading('Cuts, in order');
  const rows = sawCuts(plan, sheet, board, nameOf);
  // Offcut cut labels (`K1.1a`) need a wider number column.
  const cutTable = (part: SawCutRow[], wide = false) =>
    table(
      flow,
      MARGIN,
      [
        { header: '#', width: wide ? 15 : 10 },
        { header: 'Cut', width: 14 },
        { header: 'Fence (mm)', width: 22, align: 'end' },
        { header: 'Measured from', width: 38 },
        { header: 'Gives', width: CONTENT_WIDTH - 94 - (wide ? 5 : 0) },
        { header: 'Done', width: 10, align: 'middle' },
      ],
      part.map((r): Cell[] => [
        { text: r.label, bold: true },
        r.kind === 'rip' ? 'Rip' : 'Cross',
        { text: mmText(r.fence), bold: true },
        r.from,
        r.gives,
        { tick: true },
      ]),
    );
  const own = rows.filter((r) => r.offcut === undefined);
  if (own.length === 0) flow.paragraph('No cuts: the Board is used whole.');
  else cutTable(own);
  // Kept Offcuts cut up later for Parts that needed nesting: each has saw entries of its own.
  for (const id of [...new Set(rows.flatMap((r) => (r.offcut === undefined ? [] : [r.offcut])))]) {
    const o = board.offcuts.find((x) => x.id === id);
    flow.heading(`From kept Offcut ${id}${o ? ` (${sizeText(o.length, o.width)})` : ''}`);
    cutTable(rows.filter((r) => r.offcut === id), true);
  }
  flow.paragraph(
    `Settings are to the near side of the blade · kerf ${mmText(plan.settings.sawKerf)} · trim ${mmText(edgeTrimFor(plan.settings, sheet.sheetId))}`,
    { size: FONT.small, colour: GREY },
  );
  return flow.pages;
}

/** The Board's Breakdown, scaled to the page: front edge (Y0) at the bottom, X = Board length. Returns the y below it. */
function breakdownDrawing(
  flow: Flow,
  plan: Plan,
  sheet: SheetPlan,
  board: Board,
  nameOf: (id: string) => string,
  grain: string,
): number {
  const scale = Math.min(DRAWING_WIDTH / board.length, DRAWING_MAX_HEIGHT / board.width);
  const top = flow.y + 2;
  const height = board.width * scale;
  const X = (x: number) => DRAWING_LEFT + x * scale;
  const Y = (y: number) => top + height - y * scale;
  const items: Item[] = [];
  const rect = (x: number, y: number, length: number, width: number) => ({
    x: X(x),
    y: Y(y + width),
    width: length * scale,
    height: width * scale,
  });

  // Everything is waste until a piece covers it.
  items.push({ kind: 'hatch', ...rect(0, 0, board.length, board.width), spacing: 2.5, lineWidth: 0.15, colour: RULE });
  items.push({ kind: 'box', ...rect(0, 0, board.length, board.width), stroke: BLACK, lineWidth: 0.4 });
  const trim = edgeTrimFor(plan.settings, sheet.sheetId);
  if (trim > 0) {
    items.push({
      kind: 'box',
      ...rect(trim, trim, board.length - 2 * trim, board.width - 2 * trim),
      stroke: GREY,
      lineWidth: 0.15,
      dash: [1, 1],
    });
  }

  for (const o of board.offcuts) {
    const r = rect(o.x, o.y, o.length, o.width);
    if (o.used) {
      // Cut up later: its outline only; its Blanks and leftovers are drawn on it.
      items.push({ kind: 'box', ...r, stroke: GREY, lineWidth: 0.3, dash: [1.5, 1] });
    } else if (o.kept && !o.discarded) {
      items.push({ kind: 'box', ...r, fill: WHITE, stroke: GREY, lineWidth: 0.2, dash: [1.5, 1] });
      items.push(...pieceLabel(r, o.id ? `Keep ${o.id}` : 'Keep', sizeText(o.length, o.width), GREY));
    } else {
      const size = sizeText(o.length, o.width);
      items.push(...pieceLabel(r, '', o.discarded ? `Discarded ${o.id ?? ''} · ${size}` : `Waste ${size}`, GREY, true));
    }
  }
  for (const b of board.blanks) {
    const r = rect(b.x, b.y, b.length, b.width);
    items.push({ kind: 'box', ...r, fill: WHITE, stroke: BLACK, lineWidth: 0.35 });
    items.push(...pieceLabel(r, b.id, sizeText(b.length, b.width), BLACK));
  }
  for (const p of board.sawParts) {
    const r = rect(p.x, p.y, p.length, p.width);
    items.push({ kind: 'box', ...r, fill: SHADE, stroke: BLACK, lineWidth: 0.35 });
    items.push(...pieceLabel(r, `SAW · ${nameOf(p.partId)}`, sizeText(p.length, p.width), BLACK));
  }

  // Cuts, numbered in saw order: rips labelled left of the Board, crosscuts on their line.
  // Rip labels closer than a label's height step further left so they don't cover each other.
  let lastRip: { y: number; step: number } | null = null;
  for (const c of board.cuts) {
    if (c.kind === 'rip') {
      items.push({ kind: 'line', x1: X(c.x), y1: Y(c.y), x2: X(c.x + c.length), y2: Y(c.y), lineWidth: 0.35, dash: [2, 1] });
      const step: number = lastRip && Math.abs(lastRip.y - Y(c.y)) < 4.2 ? (lastRip.step + 1) % 2 : 0;
      if (c.from) {
        // A rip inside a kept Offcut: labelled at the Offcut's left end, on the line.
        items.push(...cutLabel(X(c.x) + cutLabelWidth(c.label) / 2 + 1, Y(c.y), c.label));
        continue;
      }
      items.push(...cutLabel(DRAWING_LEFT - 4.5 - step * 5, Y(c.y), c.label));
      lastRip = { y: Y(c.y), step };
    } else {
      items.push({ kind: 'line', x1: X(c.x), y1: Y(c.y), x2: X(c.x), y2: Y(c.y + c.length), lineWidth: 0.35, dash: [2, 1] });
      // Near the strip's far edge, clear of the piece names in the middle.
      items.push(...cutLabel(X(c.x), Math.min(Y(c.y + c.length) + 2.6, Y(c.y + c.length / 2)), c.label));
    }
  }

  // Front edge marker and caption.
  const below = top + height + 5;
  items.push({
    kind: 'polygon',
    points: [
      [DRAWING_LEFT, below - 0.4],
      [DRAWING_LEFT + 1.6, below - 3],
      [DRAWING_LEFT + 3.2, below - 0.4],
    ],
    fill: BLACK,
  });
  items.push(
    text(DRAWING_LEFT + 4.5, below, `Front edge (Y0) · X = Board length ${mmText(board.length)} · grain ${grain}`, FONT.small),
    text(X(board.length), below, sizeText(board.length, board.width), FONT.small, { align: 'end' }),
  );
  flow.add(...items);
  return Math.min(below + 1, BOTTOM);
}

/** A piece's name (bold) and size, centred and shrunk to fit; on a white label when `onHatch`. */
function pieceLabel(
  r: { x: number; y: number; width: number; height: number },
  title: string,
  size: string,
  colour: string,
  onHatch = false,
): Item[] {
  const room = r.width - 2;
  if (room >= 4 && r.height >= 1.6 && r.height < 4.5) {
    // A thin strip: name and size on one small line.
    const line = title === '' ? size : `${title} · ${size}`;
    const fs = fitSize(line, room, Math.min(2.4, r.height * 0.8), 1.2, title !== '');
    const y = r.y + r.height / 2 + fs * 0.35;
    const label = text(r.x + r.width / 2, y, line, fs, { bold: title !== '', align: 'middle', colour, max: room });
    const w = label.kind === 'text' ? textWidthOf(label.text, fs, title !== '') + 1 : 0;
    return [
      ...(onHatch ? [{ kind: 'box' as const, x: r.x + r.width / 2 - w / 2, y: y - fs, width: w, height: fs * 1.35, fill: WHITE }] : []),
      label,
    ];
  }
  if (room < 4 || r.height < 2.5) {
    // Too narrow to read across: the size alone, reading up the piece.
    if (r.width < 2 || r.height < 6) return [];
    const fs = Math.min(2.4, r.width * 0.6);
    const vx = r.x + r.width / 2 + fs * 0.35;
    const vy = r.y + r.height / 2;
    const label = text(vx, vy, size, fs, { align: 'middle', colour, max: r.height - 2, vertical: true });
    const w = label.kind === 'text' ? Math.min(r.height - 2, textWidthOf(label.text, fs) + 1) : 0;
    return [
      ...(onHatch ? [{ kind: 'box' as const, x: r.x + r.width / 2 - fs * 0.7, y: vy - w / 2, width: fs * 1.4, height: w, fill: WHITE }] : []),
      label,
    ];
  }
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const titleSize = title === '' ? 0 : fitSize(title, room, Math.min(3.6, r.height * 0.4), 1.6, true);
  const sizeSize = fitSize(size, room, Math.min(2.8, r.height * 0.3), 1.4);
  const both = title !== '' && r.height >= titleSize + sizeSize + 2;
  const items: Item[] = [];
  if (title !== '') {
    items.push(text(cx, both ? cy - 0.3 : cy + titleSize * 0.35, title, titleSize, { bold: true, align: 'middle', colour, max: room }));
  }
  if (title === '' || both) {
    const y = title === '' ? cy + sizeSize * 0.35 : cy + sizeSize + 0.3;
    if (onHatch) {
      const w = Math.min(room, textWidthOf(size, sizeSize) + 1);
      items.push({ kind: 'box', x: cx - w / 2, y: y - sizeSize, width: w, height: sizeSize * 1.35, fill: WHITE });
    }
    items.push(text(cx, y, size, sizeSize, { align: 'middle', colour, max: room }));
  }
  return items;
}

function cutLabelWidth(label: string): number {
  return Math.max(4, label.length * 1.7 + 1.6);
}

/** A cut number in a small white box centred on (x, y). */
function cutLabel(x: number, y: number, label: string): Item[] {
  const size = 2.6;
  const w = cutLabelWidth(label);
  return [
    { kind: 'box', x: x - w / 2, y: y - 1.9, width: w, height: 3.8, fill: WHITE, stroke: BLACK, lineWidth: 0.3 },
    text(x, y + 0.95, label, size, { bold: true, align: 'middle' }),
  ];
}
