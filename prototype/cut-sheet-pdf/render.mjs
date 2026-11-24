// PROTOTYPE, throwaway. Renders each variant of index.html to a PDF next to this file.
// Usage: node prototype/cut-sheet-pdf/render.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(dir, 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
for (const v of ['A', 'B', 'C']) {
  await page.goto(`${url}?variant=${v}`);
  const state = await page.evaluate(() => window.__state);
  if (v === 'A') console.log(JSON.stringify(state, null, 1));
  const out = path.join(dir, `cut-sheet-${v}.pdf`);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log(v, state.pages, 'pages ->', path.relative(process.cwd(), out));
}
await browser.close();
