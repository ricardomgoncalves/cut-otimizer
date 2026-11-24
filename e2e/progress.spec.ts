import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('Parts show only their Steps, and ticks survive a reload', async ({ page }) => {
  const progress = page.getByRole('region', { name: 'Progress' });
  await expect(progress.locator('.job-progress')).toHaveText('Job: 0 / 5 Done · 0 / 5 Cut');

  // The rail is a Saw Part with no Edgeband and no Manual ops: Cut is its only Step.
  await expect(page.getByLabel('Cut: T1 · Rail')).toBeVisible();
  await expect(page.getByLabel('Banded: T1 · Rail')).toHaveCount(0);
  await expect(page.getByLabel('Side B: T1 · Door')).toBeVisible();
  await expect(page.getByLabel('Manual ops: T1 · Shelf')).toBeVisible();

  await page.getByLabel('Cut: T1 · Rail').check();
  await page.getByLabel('Cut: T1 · Shelf').check();
  await page.getByLabel('Banded: T1 · Shelf').check();
  await page.getByLabel('Manual ops: T1 · Shelf').check();
  await expect(progress.locator('.job-progress')).toHaveText('Job: 2 / 5 Done · 2 / 5 Cut');
  await expect(progress.getByRole('table', { name: 'Owner progress' }).getByRole('row').nth(1)).toContainText('2 / 4');

  await page.reload();

  await expect(page.getByLabel('Cut: T1 · Rail')).toBeChecked();
  await expect(page.getByLabel('Manual ops: T1 · Shelf')).toBeChecked();
  await expect(page.getByLabel('Banded: T1 · Door')).not.toBeChecked();
  await expect(progress.locator('.job-progress')).toHaveText('Job: 2 / 5 Done · 2 / 5 Cut');
});

test('bulk ticks per Blank, Board and Side B file fill the roll-ups', async ({ page }) => {
  const progress = page.getByRole('region', { name: 'Progress' });
  const cuts = progress.getByRole('table', { name: 'Cut progress' });

  await page.getByRole('button', { name: 'Side A done W18-1-A' }).click();
  await expect(page.getByLabel('Cut: T1 · Door')).toBeChecked();
  await expect(page.getByLabel('Cut: T1 · Shelf')).toBeChecked();
  await expect(cuts.getByRole('row', { name: /Blank W18-1-A/ })).toContainText('2 / 2');
  await expect(cuts.getByRole('row', { name: /Blank W18-1-A/ })).toContainText('Locked');
  await expect(cuts.getByRole('row', { name: /Board W18-1/ })).toContainText('2 / 4');

  await page.getByRole('button', { name: 'Breakdown done W18 Board 1' }).click();
  await expect(page.getByLabel('Cut: T1 · Left side')).toBeChecked();
  await expect(cuts.getByRole('row', { name: /Board W18-1/ })).toContainText('4 / 4');

  await page.getByRole('region', { name: 'Side B' }).getByRole('button', { name: 'Side B done B1' }).click();
  await expect(page.getByLabel('Side B: T1 · Door')).toBeChecked();

  // Finish the Cabinet: band the three banded Parts, do the shelf's Manual op.
  for (const name of ['T1 · Left side', 'T1 · Shelf', 'T1 · Door']) await page.getByLabel(`Banded: ${name}`).check();
  await page.getByLabel('Manual ops: T1 · Shelf').check();
  const owners = progress.getByRole('table', { name: 'Owner progress' });
  await expect(owners.getByRole('row').nth(1)).toContainText('4 / 4');
  await expect(owners.getByRole('row').nth(1)).toContainText('ready to assemble');
  await expect(owners.getByRole('row').nth(2)).toContainText('Toe Kick T1');
  await expect(owners.getByRole('row').nth(2)).not.toContainText('ready to assemble');
});

test('unticking the last Cut of a Blank asks first', async ({ page }) => {
  await page.getByLabel('Cut: T1 · Door').check();
  // The box stays ticked until the untick is confirmed.
  await page.getByLabel('Cut: T1 · Door').click();

  const dialog = page.getByRole('alertdialog', { name: 'Confirm untick' });
  await expect(dialog).toContainText('would unlock W18-1-A and W18-1');
  await dialog.getByRole('button', { name: 'Keep ticked' }).click();
  await expect(page.getByLabel('Cut: T1 · Door')).toBeChecked();

  await page.getByLabel('Cut: T1 · Door').click();
  await page.getByRole('alertdialog', { name: 'Confirm untick' }).getByRole('button', { name: 'Untick' }).click();
  await expect(page.getByLabel('Cut: T1 · Door')).not.toBeChecked();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // A Step that locks nothing unticks straight away.
  await page.getByLabel('Banded: T1 · Door').check();
  await page.getByLabel('Banded: T1 · Door').uncheck();
  await expect(page.getByLabel('Banded: T1 · Door')).not.toBeChecked();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
