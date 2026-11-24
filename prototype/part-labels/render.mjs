// PROTOTYPE, throwaway. Renders each variant of index.html to a PDF (and a PNG of sheet 1) next to this file.
// Usage: node prototype/part-labels/render.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(dir, 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.error('page error:', e.message));
for (const v of ['A', 'B', 'C']) {
  await page.goto(`${url}?variant=${v}`);
  const state = await page.evaluate(() => window.__state);
  console.log(JSON.stringify(state));
  await page.pdf({ path: path.join(dir, `labels-${v}.pdf`), preferCSSPageSize: true, printBackground: true });
  await page.locator('.sheet').first().screenshot({ path: path.join(dir, `labels-${v}-sheet1.png`) });
}
await page.locator('.sheet').last().screenshot({ path: path.join(dir, `size-ladder.png`) });
await browser.close();
