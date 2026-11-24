import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/synthetic.parts.json', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Load export').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Plan' }).click();
});

test('the Flip Part is shaded in its Layout', async ({ page }) => {
  const layout = page.getByRole('img', { name: 'Layout of W18-1-A' });

  await expect(layout.locator('g.flip')).toHaveCount(1);
  await expect(layout.locator('g.flip title')).toHaveText(/T1 · Door \(Flip Part: Side B B1\)$/);
});

test('the Side B view lists each file with its bottom view, Fence corner, edge names and Parts', async ({ page }) => {
  const sideB = page.getByRole('region', { name: 'Side B' });
  const shortId = (await page.getByText(/^Short id/).locator('code').textContent()) ?? '';
  const file = sideB.getByRole('figure').filter({ hasText: 'B1' });

  await expect(file).toContainText(`${shortId}-B1.side-b.dxf`);
  await expect(file.getByRole('img', { name: 'Side B view of B1' })).toBeVisible();
  await expect(file.getByRole('img', { name: 'Side B view of B1' }).locator('.fence-corner')).toHaveCount(1);
  await expect(file).toContainText('x0 against long fence');
  await expect(file).toContainText('y0 against short fence');
  await expect(file.getByRole('listitem')).toHaveText(['T1 · Door (W18-1-A #1)']);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    file.getByRole('button', { name: 'Download B1' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${shortId}-B1.side-b.dxf`);
});

test('the Job lists its Manual ops with a warning', async ({ page }) => {
  const manual = page.getByRole('region', { name: 'Manual ops' });

  await expect(manual).toContainText('1 Manual op is not in any file: do it by hand.');
  await expect(manual.getByRole('row').filter({ hasText: 'T1 · Shelf' })).toContainText(
    'Drill Ø8 × 30 deep on x0 at y 260, z 9',
  );
});
