import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function downloadZip(page: Page): Promise<Record<string, string>> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download DXFs' }).click(),
  ]);
  const path = await download.path();
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

test('load the synthetic export, see its Blanks and download the Side A DXFs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  await page.getByLabel('Load export').setInputFiles(fixture);

  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Layout of O16-1-A' })).toBeVisible();

  const first = await downloadZip(page);
  expect(Object.keys(first)).toEqual(['W18-1-A.side-a.dxf', 'O16-1-A.side-a.dxf']);
  expect(first['W18-1-A.side-a.dxf']).toContain('OUTLINE_THRU');

  // Loading the same export again gives byte-identical DXFs.
  await page.reload();
  await page.getByLabel('Load export').setInputFiles(fixture);
  expect(await downloadZip(page)).toEqual(first);
  expect(errors).toEqual([]);
});

test('an invalid file shows its schema errors and loads nothing', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Load export').setInputFiles({
    name: 'broken.parts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'cabinet-planner/parts-export', units: 'mm' })),
  });

  await expect(page.getByRole('alert')).toContainText('/units');
  await expect(page.getByRole('button', { name: 'Download DXFs' })).toHaveCount(0);
});
