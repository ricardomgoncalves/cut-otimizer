// Page-model test helpers: a page as text (what the golden files hold), one item per line, and its text items.
import type { Item, Page } from '../src/core/documents/index.ts';

const r = (v: number) => String(Math.round(v * 10) / 10);

function line(it: Item): string {
  switch (it.kind) {
    case 'text':
      return `text ${r(it.x)},${r(it.y)} ${r(it.size)}${it.bold ? ' bold' : ''}${it.align ? ` ${it.align}` : ''}${it.colour ? ` ${it.colour}` : ''}${it.vertical ? ' vertical' : ''} ${JSON.stringify(it.text)}`;
    case 'box':
      return `box ${r(it.x)},${r(it.y)} ${r(it.width)}x${r(it.height)}${it.fill ? ` fill ${it.fill}` : ''}${it.stroke ? ` stroke ${it.stroke} ${r(it.lineWidth ?? 0)}` : ''}${it.dash ? ' dashed' : ''}`;
    case 'line':
      return `line ${r(it.x1)},${r(it.y1)} ${r(it.x2)},${r(it.y2)} ${r(it.lineWidth)}${it.colour ? ` ${it.colour}` : ''}${it.dash ? ' dashed' : ''}`;
    case 'polygon':
      return `polygon ${it.points.map(([x, y]) => `${r(x)},${r(y)}`).join(' ')}${it.fill ? ` fill ${it.fill}` : ''}${it.stroke ? ` stroke ${it.stroke}` : ''}`;
    case 'hatch':
      return `hatch ${r(it.x)},${r(it.y)} ${r(it.width)}x${r(it.height)}`;
    case 'qr':
      return `qr ${r(it.x)},${r(it.y)} ${r(it.size)} ${String(it.modules.length)}x${String(it.modules.length)}`;
  }
}

/** The page as text, one item per line. */
export function pageText(page: Page): string {
  return `${page.items.map(line).join('\n')}\n`;
}

/** The text items of a page, in drawing order. */
export const texts = (page: Page | undefined): string[] =>
  (page?.items ?? []).flatMap((it) => (it.kind === 'text' ? [it.text] : []));
