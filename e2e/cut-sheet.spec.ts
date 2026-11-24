import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('the cut sheet preview shows the cover, saw, Side A, Side B, banding and Owner pages', async ({ page }) => {
  const sheet = page.getByRole('region', { name: 'Cut sheet' });
  await sheet.getByRole('button', { name: 'Cut sheet' }).click();

  // The synthetic fixture plans to two Boards (W18 and O16), each with one Blank: cover, 2 saw pages,
  // 2 Side A pages, the Side B batch, one Edgeband list and the Owner summary.
  const pages = sheet.getByRole('img', { name: /^Cut sheet page \d+ of 8$/ });
  await expect(pages).toHaveCount(8);
  await expect(pages.nth(0)).toContainText('Before you start');
  await expect(pages.nth(0)).toContainText('Skipped items: T2');
  await expect(pages.nth(1)).toContainText('1 · Saw · W18 · Board 1 of 1');
  await expect(pages.nth(1)).toContainText('SAW · T1 · Left side');
  await expect(pages.nth(2)).toContainText('1 · Saw · O16 · Board 1 of 1');
  await expect(pages.nth(3)).toContainText('2 · CNC Side A · W18-1-A');
  await expect(pages.nth(3)).toContainText('Side A done');
  await expect(pages.nth(5)).toContainText('3 · CNC Side B batch');
  await expect(pages.nth(6)).toContainText('4 · Edge banding · White ABS');
  await expect(pages.nth(7)).toContainText('6 · Owner summary');
  await expect(pages.nth(7)).toContainText('T1 · Left side');

  await sheet.getByRole('button', { name: 'Cut sheet' }).click();
  await expect(pages).toHaveCount(0);
});

test('Download PDF saves a PDF named after the Job', async ({ page }) => {
  const sheet = page.getByRole('region', { name: 'Cut sheet' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Download PDF' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.cut-sheet\.pdf$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
