// Text for printed pages: what Helvetica can draw in a PDF, and how wide it is.
import { HELVETICA, HELVETICA_BOLD, WIN_ANSI } from './helvetica.generated.ts';

const index = new Map([...WIN_ANSI].map((ch, i) => [ch, i]));

/** The text with every character the PDF's standard fonts can't draw (outside WinAnsi) replaced by `?`. */
export function printable(text: string): string {
  return [...text].map((ch) => (index.has(ch) ? ch : '?')).join('');
}

/** Width in mm of printable text at a font size in mm. */
export function textWidth(text: string, size: number, bold = false): number {
  const widths = bold ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const ch of text) units += widths[index.get(ch) ?? index.get('?') ?? 0] ?? 556;
  return (units / 1000) * size;
}

/** The text, cut short with `…` when wider than `max` mm. */
export function fitText(text: string, max: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= max) return text;
  const chars = [...text];
  while (chars.length > 0 && textWidth(`${chars.join('')}…`, size, bold) > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/** Word-wraps text into lines no wider than `max` mm (a single long word is cut short). */
export function wrapText(text: string, max: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && textWidth(next, size, bold) > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines.map((l) => fitText(l, max, size, bold));
}
