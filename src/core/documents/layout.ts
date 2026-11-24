// Layout helpers that write page-model items: a top-to-bottom flow over A4 pages, text, tables, boxes.
import { A4, BLACK, type Item, type Page } from './page.ts';
import { fitText, printable, textWidth, wrapText } from './text.ts';

export const MARGIN = 12;
export const CONTENT_WIDTH = A4.width - 2 * MARGIN;
/** Content stops here; the footer sits below. */
export const BOTTOM = A4.height - 14;
export const FONT = { h1: 6, h2: 4.4, h3: 3.6, body: 3.1, small: 2.6 } as const;
export const GREY = '#666666';
export const RULE = '#999999';
export const SHADE = '#e5e5e5';
export const WHITE = '#ffffff';

export interface TextOptions {
  bold?: boolean;
  align?: 'start' | 'middle' | 'end';
  colour?: string;
  /** Cut short with `…` to this width (mm). */
  max?: number;
  vertical?: boolean;
}

/** A text item: printable characters only, cut short to `max` when given. */
export function text(x: number, y: number, s: string, size: number, o: TextOptions = {}): Item {
  const clean = printable(s);
  return {
    kind: 'text',
    x,
    y,
    text: o.max === undefined ? clean : fitText(clean, o.max, size, o.bold),
    size,
    ...(o.bold ? { bold: true } : {}),
    ...(o.align && o.align !== 'start' ? { align: o.align } : {}),
    ...(o.colour ? { colour: o.colour } : {}),
    ...(o.vertical ? { vertical: true } : {}),
  };
}

/** A tick box for a person to tick, `side` mm square, its bottom on `baseline` (a little below it). */
export function tickBox(x: number, baseline: number, side = 3.2): Item {
  return { kind: 'box', x, y: baseline - side + 0.5, width: side, height: side, stroke: BLACK, lineWidth: 0.25 };
}

/**
 * Writes items top to bottom over as many pages as they need. `start` draws a page's header (when
 * `continued`, a page carrying on from the one before) and returns the y where content starts.
 */
export class Flow {
  readonly pages: Page[] = [];
  y = 0;
  private readonly start: (page: Page, continued: boolean) => number;

  constructor(start: (page: Page, continued: boolean) => number) {
    this.start = start;
    this.newPage(false);
  }

  get page(): Page {
    const page = this.pages[this.pages.length - 1];
    if (!page) throw new Error('no page');
    return page;
  }

  newPage(continued: boolean): void {
    const page: Page = { ...A4, items: [] };
    this.pages.push(page);
    this.y = this.start(page, continued);
  }

  /** Starts a new page when `height` mm doesn't fit below the current position. */
  ensure(height: number): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.newPage(true);
    return true;
  }

  add(...items: Item[]): void {
    this.page.items.push(...items);
  }

  heading(s: string): void {
    this.ensure(14);
    this.y += 7;
    this.add(text(MARGIN, this.y, s, FONT.h3, { bold: true }));
    this.y += 2;
  }

  /** A paragraph, word-wrapped to `width`. */
  paragraph(s: string, o: { x?: number; width?: number; size?: number; bold?: boolean; colour?: string } = {}): void {
    const size = o.size ?? FONT.body;
    for (const line of wrapText(printable(s), o.width ?? CONTENT_WIDTH, size, o.bold)) {
      this.ensure(size * 1.4);
      this.y += size * 1.3;
      this.add(text(o.x ?? MARGIN, this.y, line, size, { bold: o.bold ?? false, ...(o.colour ? { colour: o.colour } : {}) }));
    }
  }
}

export interface Column {
  header: string;
  width: number;
  align?: 'start' | 'end' | 'middle';
}

/**
 * A table cell: text, or a tick box. `sub` is a second, smaller grey line under the text (the row grows to
 * hold it); `pill` shades a box behind the text (a file name to look for, like a Side B file).
 */
export type Cell = string | TextCell | { tick: true };

export interface TextCell {
  text: string;
  bold?: boolean;
  colour?: string;
  sub?: string;
  pill?: boolean;
}

const ROW = 4.8;
/** The extra height of a row with a `sub` line. */
const SUB = 2.8;
const PAD = 1.2;

/**
 * A table at `x`, rows of cells under a header row. Text is cut short to its column. When a row doesn't
 * fit, the table carries on on a new page under a repeated header. Returns nothing; `flow.y` ends below it.
 */
export function table(flow: Flow, x: number, columns: Column[], rows: Cell[][], size: number = FONT.body): void {
  const width = columns.reduce((a, c) => a + c.width, 0);
  const header = () => {
    flow.y += ROW;
    let cx = x;
    for (const c of columns) {
      flow.add(cellText(cx, flow.y - PAD - 0.2, c, { text: c.header, colour: GREY, bold: true }, FONT.small));
      cx += c.width;
    }
    flow.add({ kind: 'line', x1: x, y1: flow.y, x2: x + width, y2: flow.y, lineWidth: 0.3 });
  };
  flow.ensure(2 * ROW);
  header();
  for (const row of rows) {
    const height = row.some((cell) => typeof cell === 'object' && 'sub' in cell && cell.sub !== undefined) ? ROW + SUB : ROW;
    if (flow.ensure(height)) header();
    const baseline = flow.y + ROW - PAD;
    flow.y += height;
    let cx = x;
    columns.forEach((c, i) => {
      const cell = row[i] ?? '';
      if (typeof cell === 'object' && 'tick' in cell) {
        flow.add(tickBox(cx + (c.width - 3.2) / 2, baseline));
      } else if (cell !== '') {
        const t: TextCell = typeof cell === 'string' ? { text: cell } : cell;
        if (t.pill) flow.add(pill(cx, baseline - 0.2, c, t, size));
        flow.add(cellText(cx, baseline - 0.2, c, t, size));
        if (t.sub !== undefined) flow.add(cellText(cx, baseline - 0.2 + SUB, c, { text: t.sub, colour: GREY }, FONT.small * 0.9));
      }
      cx += c.width;
    });
    flow.add({ kind: 'line', x1: x, y1: flow.y, x2: x + width, y2: flow.y, lineWidth: 0.1, colour: RULE });
  }
}

/** The shaded box behind a pill cell's text. */
function pill(x: number, baseline: number, c: Column, cell: TextCell, size: number): Item {
  const label = cellText(x, baseline, c, cell, size);
  if (label.kind !== 'text') throw new Error('cellText makes text');
  const w = textWidth(label.text, size, cell.bold);
  const start = label.align === 'middle' ? label.x - w / 2 : label.align === 'end' ? label.x - w : label.x;
  return { kind: 'box', x: start - 0.8, y: baseline - size * 0.85, width: w + 1.6, height: size * 1.15, fill: SHADE };
}

function cellText(
  x: number,
  baseline: number,
  c: Column,
  cell: TextCell,
  size: number,
): Item {
  const inner = c.width - 2 * PAD;
  const align = c.align ?? 'start';
  const at = align === 'start' ? x + PAD : align === 'end' ? x + c.width - PAD : x + c.width / 2;
  return text(at, baseline, cell.text, size, {
    max: inner,
    align,
    ...(cell.bold ? { bold: true } : {}),
    ...(cell.colour ? { colour: cell.colour } : {}),
  });
}

/** The largest font size up to `max` at which the text fits `width` (never below `min`). */
export function fitSize(s: string, width: number, max: number, min: number, bold = false): number {
  const w = textWidth(printable(s), max, bold);
  return w <= width ? max : Math.max(min, (max * width) / w);
}
