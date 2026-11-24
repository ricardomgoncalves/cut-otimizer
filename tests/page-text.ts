// Page-model test helpers: a page as text (what the golden files hold) and its text items.
import type { Page } from '../src/core/documents/index.ts';

/** The page as text, one item per line. */
export function pageText(page: Page): string {
  const r = (v: number) => String(Math.round(v * 10) / 10);
  return `${page.items
    .map((it) => {
      switch (it.kind) {
        case 'text':
          return `text ${r(it.x)},${r(it.y)} ${r(it.size)}${it.bold ? ' bold' : ''}${it.align ? ` ${it.align}` : ''}${it.colour ? ` ${it.colour}` : ''}${it.vertical ? ' vertical' : ''} ${JSON.stringify(it.text)}`;
        case 'box':
          return `box ${r(it.x)},${r(it.y)} ${r(it.width)}x${r(it.height)}${it.fill ? ` fill ${it.fill}` : ''}${it.stroke ? ` stroke ${it.stroke} ${r(it.lineWidth ?? 0)}` : ''}${it.dash ? ' dashed' : ''}`;
        case 'line':
          return `line ${r(it.x1)},${r(it.y1)} ${r(it.x2)},${r(it.y2)} ${r(it.lineWidth)}${it.dash ? ' dashed' : ''}`;
        case 'polygon':
          return `polygon ${it.points.map(([x, y]) => `${r(x)},${r(y)}`).join(' ')}`;
        case 'hatch':
          return `hatch ${r(it.x)},${r(it.y)} ${r(it.width)}x${r(it.height)}`;
        case 'qr':
          return `qr ${r(it.x)},${r(it.y)} ${r(it.size)}`;
      }
    })
    .join('\n')}\n`;
}

/** The text items of a page, in drawing order. */
export const texts = (page: Page | undefined): string[] =>
  (page?.items ?? []).flatMap((it) => (it.kind === 'text' ? [it.text] : []));
