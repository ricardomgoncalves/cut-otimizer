import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

async function downloadZip(page: Page): Promise<Record<string, string>> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download DXFs' }).click(),
  ]);
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

async function setClampMargin(page: Page, mm: string) {
  await page.getByRole('button', { name: 'Machine settings' }).click();
  await page.getByLabel('Clamp margin (mm)').fill(mm);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Job', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('a Locked Blank survives Regenerate with new settings; the rest is planned again', async ({ page }) => {
  const before = await downloadZip(page);
  await page.getByLabel('Cut: T1 · Shelf').check();
  await expect(page.locator('figure', { hasText: 'W18-1-A' }).locator('.locked')).toHaveText(' · Locked');

  await setClampMargin(page, '60');
  const stale = page.getByRole('status').filter({ hasText: 'different Machine settings' });
  await expect(stale).toContainText('Locked Boards and Blanks');
  await stale.getByRole('button', { name: 'Regenerate' }).click();
  await expect(stale).toHaveCount(0);

  const after = await downloadZip(page);
  expect(after['W18-1-A.side-a.dxf']).toEqual(before['W18-1-A.side-a.dxf']);
  expect(after['O16-1-A.side-a.dxf']).not.toEqual(before['O16-1-A.side-a.dxf']);

  // A Part on a Locked Board keeps its place: no Saw / CNC toggle, and the Sheet keeps its code.
  const rail = page.getByRole('table', { name: 'Parts of W18' }).getByRole('row', { name: /Rail/ });
  await rail.getByLabel('Saw').click();
  await expect(page.getByRole('alert')).toContainText('on Locked Board W18-1');
  await expect(rail.getByLabel('Saw')).toBeChecked();
  await page.getByLabel('Sheet code for White melamine chipboard 18').fill('X18');
  await page.getByLabel('Sheet code for White melamine chipboard 18').press('Enter');
  await expect(page.getByRole('alert')).toContainText('W18 has Locked Boards');
});

test('unticking the last Cut unlocks the Blank after confirmation', async ({ page }) => {
  await page.getByLabel('Cut: T1 · Shelf').check();
  const figure = page.locator('figure', { hasText: 'W18-1-A' });
  await expect(figure.locator('.locked')).toHaveCount(1);

  await page.getByLabel('Cut: T1 · Shelf').click();
  await page.getByRole('alertdialog', { name: 'Confirm untick' }).getByRole('button', { name: 'Untick' }).click();
  await expect(figure.locator('.locked')).toHaveCount(0);
});
