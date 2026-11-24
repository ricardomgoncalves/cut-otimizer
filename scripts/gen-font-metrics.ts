// Generates Helvetica and Helvetica-Bold glyph widths for the characters the PDF's standard fonts can
// encode (WinAnsi), so the pure Documents module can measure text the way pdf-lib will draw it.
// Run `bun run gen:fonts` after a pdf-lib upgrade.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';

const outPath = fileURLToPath(new URL('../src/core/documents/helvetica.generated.ts', import.meta.url));
const winAnsi = Encodings.WinAnsi;
const codePoints = [...winAnsi.supportedCodePoints].filter((c) => c >= 32).sort((a, b) => a - b);
const widths = (name: FontNames) => {
  const font = Font.load(name);
  return codePoints.map((c) => font.getWidthOfGlyph(winAnsi.encodeUnicodeCodePoint(c).name) ?? 0);
};

const ts = `/* Generated from @pdf-lib/standard-fonts by scripts/gen-font-metrics.ts. Do not edit; run \`bun run gen:fonts\`. */
/** Every character Helvetica can draw in a PDF (WinAnsi), in code point order. */
export const WIN_ANSI = ${JSON.stringify(String.fromCodePoint(...codePoints))};
/** Glyph widths in 1/1000 em, one per WIN_ANSI character. */
export const HELVETICA = ${JSON.stringify(widths(FontNames.Helvetica))};
export const HELVETICA_BOLD = ${JSON.stringify(widths(FontNames.HelveticaBold))};
`;
await writeFile(outPath, ts);
console.log(`wrote ${outPath}`);
