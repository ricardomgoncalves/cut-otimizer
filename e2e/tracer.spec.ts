import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function loadAndPlan(page: Page) {
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
}

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

  await loadAndPlan(page);

  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Layout of O16-1-A' })).toBeVisible();

  const first = await downloadZip(page);
  expect(Object.keys(first)).toEqual(['W18-1-A.side-a.dxf', 'O16-1-A.side-a.dxf']);
  expect(first['W18-1-A.side-a.dxf']).toContain('OUTLINE_THRU');

  // Loading the same export again gives byte-identical DXFs.
  await page.reload();
  await loadAndPlan(page);
  expect(await downloadZip(page)).toEqual(first);
  expect(errors).toEqual([]);
});

test('the import summary shows Parts, Sheets, Owners and issues before planning', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);

  const summary = page.getByRole('region', { name: 'Import summary' });
  await expect(summary.getByRole('row', { name: /W18 White melamine chipboard 18/ })).toBeVisible();
  await expect(summary.getByRole('row', { name: /O16 Oak MDF 16/ })).toBeVisible();
  await expect(summary.getByRole('row', { name: /T1 Tall door/ })).toBeVisible();
  await expect(summary.getByRole('row', { name: /Toe Kick T1/ }).first()).toBeVisible();
  await expect(summary.getByText('T1 · Left side', { exact: true })).toBeVisible();
  await expect(summary.getByText('T1 · Door', { exact: true })).toBeVisible();
  await expect(summary.getByRole('listitem').filter({ hasText: 'rail' })).toContainText('c1/s0.rail[1]');
  await expect(page.getByRole('img', { name: /Layout of/ })).toHaveCount(0);

  // The Skipped item is a persistent warning: still there after planning.
  const skipped = page.getByRole('region', { name: 'Skipped items' });
  await expect(skipped).toContainText('T2');
  await expect(skipped).toContainText('invalid');
  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' })).toBeVisible();
  await expect(skipped).toContainText('T2');
});

test('the Blank Layout view shows Part names, and the raw name in the Part detail', async ({ page }) => {
  await page.goto('/');
  await loadAndPlan(page);

  const layout = page.getByRole('figure').filter({ has: page.getByRole('img', { name: 'Layout of O16-1-A' }) });
  const toeKick = layout.getByRole('listitem').filter({ hasText: 'Toe Kick T1' });
  await expect(toeKick).toBeVisible();
  await toeKick.getByText('Toe Kick T1', { exact: true }).click();
  await expect(toeKick.locator('.raw-name').first()).toHaveText('toeKick');
  await expect(page.getByRole('figure').getByText('T1 · Door', { exact: true })).toBeVisible();
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
