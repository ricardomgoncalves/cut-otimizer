// SVG renderer for the page model: one <svg> per page, in mm, for the in-app preview.
import { BLACK, hatchLines, qrSquares, type Item, type Page } from './page.ts';

const n = (v: number) => String(Math.round(v * 1000) / 1000);

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dash(d: number[] | undefined): string {
  return d && d.length > 0 ? ` stroke-dasharray="${d.map(n).join(' ')}"` : '';
}

function item(it: Item): string {
  switch (it.kind) {
    case 'box':
      return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.width)}" height="${n(it.height)}" fill="${it.fill ?? 'none'}"${
        it.stroke ? ` stroke="${it.stroke}" stroke-width="${n(it.lineWidth ?? 0.2)}"` : ''
      }${dash(it.dash)}/>`;
    case 'text': {
      const anchor = it.align && it.align !== 'start' ? ` text-anchor="${it.align}"` : '';
      const weight = it.bold ? ' font-weight="bold"' : '';
      return `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${n(it.size)}"${anchor}${weight} fill="${it.colour ?? BLACK}">${escape(it.text)}</text>`;
    }
    case 'line':
      return `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${it.colour ?? BLACK}" stroke-width="${n(it.lineWidth)}"${dash(it.dash)}/>`;
    case 'polygon':
      return `<polygon points="${it.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${it.fill ?? 'none'}"${
        it.stroke ? ` stroke="${it.stroke}" stroke-width="${n(it.lineWidth ?? 0.2)}"` : ''
      }/>`;
    case 'hatch':
      return `<g stroke="${it.colour}" stroke-width="${n(it.lineWidth)}">${hatchLines(it)
        .map(([x1, y1, x2, y2]) => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`)
        .join('')}</g>`;
    case 'qr':
      return qrSquares(it)
        .map(([x, y, s]) => `<rect class="qr" x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" fill="${BLACK}"/>`)
        .join('');
  }
}

/** One page as a standalone SVG document fragment, sized in mm. */
export function pageToSvg(page: Page): string {
  const { width, height } = page;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}mm" height="${n(height)}mm"` +
    ` font-family="Helvetica, Arial, sans-serif">` +
    `<rect width="${n(width)}" height="${n(height)}" fill="#ffffff"/>` +
    page.items.map(item).join('') +
    `</svg>`
  );
}
