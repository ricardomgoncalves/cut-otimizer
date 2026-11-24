import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

const shelfRow = (page: Page) => page.getByRole('table', { name: 'Parts of W18' }).getByRole('row', { name: /Shelf/ });

async function remakeShelf(page: Page) {
  await page.getByLabel('Cut: T1 · Shelf').check();
  await shelfRow(page).getByRole('button', { name: 'Remake T1 · Shelf' }).click();
  await page.getByRole('alertdialog', { name: 'Confirm Remake' }).getByRole('button', { name: 'Remake' }).click();
}

test('kept Offcuts show their ids, and Discard can be undone and is stored in the Job', async ({ page }) => {
  const breakdown = page.getByRole('img', { name: 'Breakdown of W18 Board 1' });
  await expect(breakdown.locator('g.offcut.kept').first()).toContainText('Keep W18-1-K1');

  const discard = page.getByLabel('Discard W18-1-K1');
  await discard.check();
  await expect(breakdown.locator('g.offcut.discarded')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Discard W18-1-K1')).toBeChecked();
  await page.getByLabel('Discard W18-1-K1').uncheck();
  await expect(breakdown.locator('g.offcut.discarded')).toHaveCount(0);
});

test('a Remake Part clears its ticks, stays greyed on its Locked Blank, and is nested on a kept Offcut', async ({ page }) => {
  await remakeShelf(page);

  await expect(page.getByLabel('Cut: T1 · Shelf')).not.toBeChecked();
  await expect(shelfRow(page)).toContainText('needs nesting');
  const oldBlank = page.locator('figure', { hasText: 'W18-1-A' });
  await expect(oldBlank.locator('.locked')).toHaveText(' · Locked');
  await expect(page.getByRole('img', { name: 'Layout of W18-1-A' }).locator('g.remade')).toHaveCount(1);

  const box = page.getByRole('status').filter({ hasText: 'need nesting' });
  await box.getByRole('button', { name: 'Regenerate' }).click();
  await expect(box).toHaveCount(0);

  await expect(page.getByRole('img', { name: 'Layout of W18-1-B' })).toBeVisible();
  await expect(shelfRow(page)).toContainText('W18-1-B #1');
  await expect(page.getByRole('table', { name: 'Cuts of W18 Board 1' })).toContainText('from W18-1-K');
});

test('asks before adding a Board when nothing else fits', async ({ page }) => {
  const discarded = page.getByRole('img', { name: 'Breakdown of W18 Board 1' }).locator('g.offcut.discarded');
  // W18 Board 1 keeps three Offcuts.
  for (const n of [1, 2, 3]) {
    await page.getByLabel(`Discard W18-1-K${String(n)}`).check();
    await expect(discarded).toHaveCount(n);
  }
  await remakeShelf(page);
  await page.getByRole('status').filter({ hasText: 'need nesting' }).getByRole('button', { name: 'Regenerate' }).click();

  const ask = page.getByRole('region', { name: 'Parts that did not fit' });
  await expect(ask).toContainText('T1 · Shelf');
  await expect(page.getByRole('img', { name: 'Layout of W18-2-A' })).toHaveCount(0);
  await ask.getByRole('button', { name: 'Add Board 2 of 2 to W18' }).click();

  await expect(ask).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Layout of W18-2-A' })).toBeVisible();
});
