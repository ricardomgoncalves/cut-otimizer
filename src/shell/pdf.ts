// PDF renderer for the page model (pdf-lib, standard Helvetica fonts, nothing embedded but the fonts' names).
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { BLACK, hatchLines, qrSquares, type Item, type Page } from '../core/documents/index.ts';

/** Points per mm. */
const K = 72 / 25.4;

function colour(hex: string): RGB {
  const v = Number.parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** Replaces what the font cannot encode (WinAnsi) with `?`. */
function encodable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map((ch) => (supported.has(ch.codePointAt(0) ?? 0) ? ch : '?')).join('');
}

/** Draws the pages into one PDF document. */
export async function pagesToPdf(pages: Page[], meta: { title: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setCreator('cut-optimizer');
  doc.setProducer('cut-optimizer (pdf-lib)');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const page of pages) {
    const pdfPage = doc.addPage([page.width * K, page.height * K]);
    for (const it of page.items) drawItem(pdfPage, page.height, it, it.kind === 'text' && it.bold ? bold : regular);
  }
  return doc.save();
}

function drawItem(p: PDFPage, height: number, it: Item, font: PDFFont): void {
  const X = (x: number) => x * K;
  const Y = (y: number) => (height - y) * K;
  switch (it.kind) {
    case 'box':
      p.drawRectangle({
        x: X(it.x),
        y: Y(it.y + it.height),
        width: it.width * K,
        height: it.height * K,
        ...(it.fill ? { color: colour(it.fill) } : {}),
        ...(it.stroke
          ? {
              borderColor: colour(it.stroke),
              borderWidth: (it.lineWidth ?? 0.2) * K,
              ...(it.dash ? { borderDashArray: it.dash.map((d) => d * K) } : {}),
            }
          : {}),
      });
      return;
    case 'text': {
      const text = encodable(font, it.text);
      const size = it.size * K;
      const width = font.widthOfTextAtSize(text, size);
      const shift = it.align === 'middle' ? width / 2 : it.align === 'end' ? width : 0;
      const color = colour(it.colour ?? BLACK);
      if (it.vertical) {
        p.drawText(text, { x: X(it.x), y: Y(it.y) - shift, size, font, color, rotate: degrees(90) });
      } else {
        p.drawText(text, { x: X(it.x) - shift, y: Y(it.y), size, font, color });
      }
      return;
    }
    case 'line':
      p.drawLine({
        start: { x: X(it.x1), y: Y(it.y1) },
        end: { x: X(it.x2), y: Y(it.y2) },
        thickness: it.lineWidth * K,
        color: colour(it.colour ?? BLACK),
        ...(it.dash ? { dashArray: it.dash.map((d) => d * K) } : {}),
      });
      return;
    case 'polygon': {
      // drawSvgPath takes SVG coordinates (y down) from the origin given: the page's top-left corner.
      const d = `${it.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${String(x * K)} ${String(y * K)}`).join(' ')} Z`;
      p.drawSvgPath(d, {
        x: 0,
        y: height * K,
        ...(it.fill ? { color: colour(it.fill) } : {}),
        ...(it.stroke ? { borderColor: colour(it.stroke), borderWidth: (it.lineWidth ?? 0.2) * K } : {}),
      });
      return;
    }
    case 'hatch':
      for (const [x1, y1, x2, y2] of hatchLines(it)) {
        p.drawLine({
          start: { x: X(x1), y: Y(y1) },
          end: { x: X(x2), y: Y(y2) },
          thickness: it.lineWidth * K,
          color: colour(it.colour),
        });
      }
      return;
    case 'qr':
      for (const [x, y, s] of qrSquares(it)) {
        p.drawRectangle({ x: X(x), y: Y(y + s), width: s * K, height: s * K, color: rgb(0, 0, 0) });
      }
      return;
  }
}
