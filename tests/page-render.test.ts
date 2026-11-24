import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { A4, pageToSvg, type Page } from '../src/core/documents/index.ts';
import { pagesToPdf } from '../src/shell/pdf.ts';

/** One page with every item kind. */
const page: Page = {
  ...A4,
  items: [
    { kind: 'box', x: 10, y: 10, width: 50, height: 20, stroke: '#000000', lineWidth: 0.3, fill: '#eeeeee' },
    { kind: 'text', x: 12, y: 16, text: 'Cut sheet · Kitchen <B1> & co', size: 4, bold: true },
    { kind: 'text', x: 200, y: 16, text: 'Ø5 × 12 — 1/2', size: 3, align: 'end', colour: '#666666' },
    { kind: 'line', x1: 10, y1: 40, x2: 200, y2: 40, lineWidth: 0.5, dash: [2, 1] },
    { kind: 'polygon', points: [[20, 50], [40, 50], [30, 65]], fill: '#000000' },
    { kind: 'hatch', x: 60, y: 50, width: 40, height: 20, spacing: 3, lineWidth: 0.2, colour: '#999999' },
    {
      kind: 'qr',
      x: 120,
      y: 50,
      size: 21,
      modules: [
        [true, false, true],
        [false, true, false],
        [true, false, true],
      ],
    },
  ],
};

describe('SVG renderer', () => {
  it('draws a page as one A4 SVG in mm, with text escaped', () => {
    const svg = pageToSvg(page);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 210 297"');
    expect(svg).toContain('Cut sheet · Kitchen &lt;B1&gt; &amp; co');
    expect(svg.match(/<svg/g)).toHaveLength(1);
    // 5 dark QR modules, 1 box, 1 polygon.
    expect(svg.match(/class="qr"/g)).toHaveLength(5);
    expect(svg).toContain('<polygon');
  });
});

describe('PDF renderer', () => {
  it('produces a valid PDF with one A4 page per page', async () => {
    const bytes = await pagesToPdf([page, { ...A4, items: [] }], { title: 'Cut sheet' });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo((210 / 25.4) * 72, 1);
    expect(size.height).toBeCloseTo((297 / 25.4) * 72, 1);
    expect(doc.getTitle()).toBe('Cut sheet');
  });

  it('draws text the standard fonts cannot encode as "?" instead of failing', async () => {
    const odd: Page = { ...A4, items: [{ kind: 'text', x: 10, y: 10, text: 'Kasten → 書棚 ✓', size: 4 }] };

    const doc = await PDFDocument.load(await pagesToPdf([odd], { title: 'x' }));
    expect(doc.getPageCount()).toBe(1);
  });
});
