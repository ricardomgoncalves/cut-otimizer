import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('the labels preview shows one sheet with a label per Part, Saw Parts first', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Part labels' });
  await region.getByRole('button', { name: 'Labels', exact: true }).click();

  const sheets = region.getByRole('img', { name: /^Label sheet \d of 1$/ });
  await expect(sheets).toHaveCount(1);
  // Five Parts: the two Saw Parts, then the Blank Parts.
  await expect(sheets.first().locator('text', { hasText: /^Saw · W18 Board 1$/ })).toHaveCount(2);
  await expect(sheets.first()).toContainText('W18-1-A #1');
  await expect(sheets.first()).toContainText('SIDE B');
});

test('Download labels PDF saves a PDF named after the Job', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Part labels' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    region.getByRole('button', { name: 'Download labels PDF' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.labels\.pdf$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('Download size ladder PDF saves the test page', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Part labels' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    region.getByRole('button', { name: 'Download size ladder PDF' }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('size-ladder.pdf');
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
